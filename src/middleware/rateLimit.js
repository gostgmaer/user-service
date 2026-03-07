// src/middleware/rateLimit.js
'use strict';

const rateLimit      = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const env            = require('../config/env');
const { getRedisClient } = require('../config/redis');

const makeHandler = (message) => (req, res) => {
  res.status(429).json({
    success: false,
    statusCode: 429,
    message,
    error: { code: 'RATE_LIMIT_EXCEEDED' },
  });
};

const makeStore = (prefix) => {
  const client = getRedisClient();
  if (!client) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args) => client.call(...args),
  });
};

// General API limiter
const apiLimiter = rateLimit({
  windowMs:        env.rateLimit.api.windowMs,
  max:             env.rateLimit.api.max,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         makeHandler('Too many requests. Please try again later.'),
  store:           makeStore('api'),
});

// Bulk operation limiter (import, bulk delete, bulk update)
const bulkOperationLimiter = rateLimit({
  windowMs:        env.rateLimit.bulk.windowMs,
  max:             env.rateLimit.bulk.max,
  standardHeaders: true,
  legacyHeaders:   false,
  handler:         makeHandler('Bulk operation rate limit exceeded.'),
  store:           makeStore('bulk'),
});

module.exports = { apiLimiter, bulkOperationLimiter };
