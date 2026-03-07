// src/middleware/metrics.middleware.js
'use strict';

const client = require('prom-client');

// Create a single shared registry
const register = new client.Registry();

// Collect default Node.js metrics (memory, CPU, event loop lag, etc.)
client.collectDefaultMetrics({ register, prefix: 'user_service_' });

// ── Custom HTTP metrics ───────────────────────────────────────────────────────

const httpRequestTotal = new client.Counter({
  name:       'user_service_http_requests_total',
  help:       'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers:  [register],
});

const httpRequestDuration = new client.Histogram({
  name:       'user_service_http_request_duration_seconds',
  help:       'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets:    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers:  [register],
});

const activeConnections = new client.Gauge({
  name:      'user_service_active_connections',
  help:      'Number of currently active HTTP connections',
  registers: [register],
});

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Instrument every HTTP request.
 * Attach before routes so all requests are captured.
 */
const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime.bigint();
  activeConnections.inc();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e9;
    // Use cleaned route pattern when available (e.g. /api/users/:id)
    const route = req.route?.path
      ? `${req.baseUrl || ''}${req.route.path}`
      : req.path;

    httpRequestTotal.labels(req.method, route, String(res.statusCode)).inc();
    httpRequestDuration.labels(req.method, route, String(res.statusCode)).observe(durationMs);
    activeConnections.dec();
  });

  res.on('close', () => activeConnections.dec());

  next();
};

/**
 * GET /metrics handler — exposes Prometheus text format.
 * Should be protected in production (IP whitelist or internal-only network).
 */
const metricsHandler = async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
};

module.exports = { metricsMiddleware, metricsHandler, register };
