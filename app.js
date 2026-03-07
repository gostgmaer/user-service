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
