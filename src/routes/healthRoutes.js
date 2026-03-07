// src/routes/healthRoutes.js
'use strict';

const router          = require('express').Router();
const { isConnected } = require('../config/db');
const { isRedisReady } = require('../config/redis');
const { version }     = require('../../package.json');

/**
 * GET /health/live — Kubernetes liveness probe.
 * Returns 200 as long as the process is running (no dependency checks).
 */
router.get('/live', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'user-service' });
});

/**
 * GET /health/ready — Kubernetes readiness probe.
 * Returns 200 only when all critical dependencies are reachable.
 */
router.get('/ready', (_req, res) => {
  const db    = isConnected() ? 'ok' : 'unavailable';
  const redis = isRedisReady() ? 'ok' : 'unavailable';
  const ready = db === 'ok';           // Redis is optional
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', db, redis });
});

/**
 * GET /health — Full health check with system metrics (legacy + dashboard use).
 */
router.get('/', (_req, res) => {
  const db    = isConnected() ? 'ok' : 'degraded';
  const redis = isRedisReady() ? 'ok' : 'unavailable';
  const mem   = process.memoryUsage();
  const status = db === 'ok' ? 'ok' : 'degraded';

  res.status(db === 'ok' ? 200 : 503).json({
    status,
    service:   'user-service',
    version,
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
    pid:       process.pid,
    dependencies: { db, redis },
    memory: {
      rss:       `${Math.round(mem.rss / 1024 / 1024)} MB`,
      heapUsed:  `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
    },
  });
});

module.exports = router;
