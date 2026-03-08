// app.js — Express application factory
'use strict';

const express        = require('express');
const helmet         = require('helmet');
const cors           = require('cors');
const cookieParser   = require('cookie-parser');
const morgan         = require('morgan');
const hpp            = require('hpp');
const crypto         = require('crypto');

const compression          = require('./src/middleware/compression.middleware');
const { sanitizeInput }    = require('./src/middleware/sanitization');
const { loggerMiddleware } = require('./src/middleware/loggerMiddleware');
const { requestTimeout }   = require('./src/middleware/timeout.middleware');
const { metricsMiddleware, metricsHandler } = require('./src/middleware/metrics.middleware');
const { errorHandler }     = require('./src/middleware/errorHandler');
const logger               = require('./src/services/logger');
const swaggerUi            = require('swagger-ui-express');
const swaggerSpec          = require('./src/config/swagger');

const userRoutes   = require('./src/routes/userRoutes');
const healthRoutes = require('./src/routes/healthRoutes');

const app = express();

// Trust the first proxy in the chain (load balancer / API gateway)
app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '1', 10));

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || corsOrigins.includes('*') || corsOrigins.includes(origin)) {
      return cb(null, true);
    }
    const corsErr = new Error(`CORS: origin ${origin} not allowed`);
    corsErr.statusCode  = 403;
    corsErr.isOperational = true;
    corsErr.code        = 'FORBIDDEN';
    cb(corsErr);
  },
  credentials: true,
  methods:  ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id',
    'X-API-Key', 'X-Service-Name', 'X-User-Context', 'X-Gateway-Secret',
  ],
  exposedHeaders: ['X-Request-Id'],
}));

// ── Compression ───────────────────────────────────────────────────────────────
app.use(compression);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());

// ── HTTP Parameter Pollution protection ──────────────────────────────────────
app.use(hpp({
  whitelist: ['status', 'roles', 'fields', 'sort'],   // allow array params where intentional
}));

// ── Sanitization (XSS + NoSQL injection) ─────────────────────────────────────
app.use(sanitizeInput);

// ── Request ID ────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
});

// ── Response envelope ─────────────────────────────────────────────────────────
// Injects: timestamp, requestId, statusCode, status into every JSON response.
// Also serialises _id → id (string), strips __v, strips null values, sets headers.
app.use((req, res, next) => {
  res.setHeader('X-Request-ID', req.requestId);
  const _json = res.json.bind(res);
  res.json = function (body) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (body !== null && body !== undefined && typeof body === 'object' && !Array.isArray(body)) {
      body.timestamp  = new Date().toISOString();
      body.requestId  = req.requestId;
      body.statusCode = res.statusCode;
      body.status     = res.statusCode < 400 ? 'success' : 'error';
    }
    return _json(_cleanResponse(body));
  };
  next();
});

// ── Request timeout (30 s) ────────────────────────────────────────────────────
app.use(requestTimeout(30_000));

// ── Prometheus metrics instrumentation ───────────────────────────────────────
app.use(metricsMiddleware);

// ── HTTP logging ──────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip:   (req) => req.path === '/health' || req.path === '/health/live',
  }));
  app.use(loggerMiddleware);
}

// ── Health (no auth required) ─────────────────────────────────────────────────
app.use('/health', healthRoutes);

// ── Prometheus scrape endpoint (internal / ops-team use only) ─────────────────
app.get('/metrics', metricsHandler);

// ── OpenAPI / Swagger docs (disabled in production by default) ────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'User Service API Docs',
    swaggerOptions:  { persistAuthorization: true },
  }));
  app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));
}

// ── Tenant resolution ───────────────────────────────────────────────────────
// Health, metrics, and docs registered above are intentionally excluded.
const { resolveTenantMiddleware } = require('./src/middleware/tenant');
app.use(resolveTenantMiddleware);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/users', userRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success:    false,
    statusCode: 404,
    message:    `Route ${req.method} ${req.originalUrl} not found`,
    error:      { code: 'NOT_FOUND' },
  });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;

// ── Response transform ────────────────────────────────────────────────────────
// Serialises Mongoose docs (_id → id, drops __v) and strips null values.
function _cleanResponse(val) {
  if (val === null || val === undefined) return undefined;
  if (typeof val !== 'object') return val;
  if (val instanceof Date) return val;
  if (Buffer.isBuffer(val)) return val;
  if (Array.isArray(val)) return val.map(_cleanResponse).filter(v => v !== undefined);
  const src = typeof val.toJSON === 'function' ? val.toJSON() : val;
  if (typeof src !== 'object' || src === null) return src;
  const out = {};
  for (const key of Object.keys(src)) {
    if (key === '__v' || key === '_id' || key === 'id' ||
        key === 'isDeleted' || key === 'deletedAt' ||
        key === 'created_by' || key === 'updated_by' || key === 'deleted_by') continue;
    const v = _cleanResponse(src[key]);
    if (v !== undefined) out[key] = v;
  }
  const rawId = src.id !== undefined ? src.id : src._id;
  if (rawId !== undefined) out.id = String(rawId);
  return out;
}
