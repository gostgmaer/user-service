// src/config/env.js
// Single source of truth for all configuration.
// All other files import from here — never from process.env directly.
'use strict';

const e = require('./validateEnv');

const env = {
  // ── Application ──────────────────────────────────────────────────────────
  NODE_ENV:    e.NODE_ENV,
  PORT:        e.PORT,
  IS_PROD:     e.NODE_ENV === 'production',
  IS_DEV:      e.NODE_ENV === 'development',
  IS_TEST:     e.NODE_ENV === 'test',
  TRUST_PROXY: e.TRUST_PROXY,
  SERVICE_NAME: e.SERVICE_NAME || 'user-service',

  // ── Database ─────────────────────────────────────────────────────────────
  MONGO_URI: e.MONGO_URI,

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_URL: e.REDIS_URL || '',

  // ── JWT (must be identical across all microservices) ─────────────────────
  jwt: {
    accessSecret:  e.JWT_ACCESS_SECRET,
    refreshSecret: e.JWT_REFRESH_SECRET,
    idSecret:      e.JWT_ID_SECRET,
    accessExpiry:  e.JWT_ACCESS_EXPIRY,
    refreshExpiry: e.JWT_REFRESH_EXPIRY,
    idExpiry:      e.JWT_ID_EXPIRY,
    issuer:        e.JWT_ISSUER,
    audience:      e.JWT_AUDIENCE,
    algorithm:     e.JWT_ALGORITHM || 'HS256',
  },

  // ── Service-to-service auth ───────────────────────────────────────────────
  SERVICE_API_KEY:          e.SERVICE_API_KEY || '',
  ALLOWED_SERVICE_API_KEYS: e.ALLOWED_SERVICE_API_KEYS || '',
  TRUST_GATEWAY:            e.TRUST_GATEWAY === 'true',
  GATEWAY_SECRET:           e.GATEWAY_SECRET || '',

  // ── Security ─────────────────────────────────────────────────────────────
  BCRYPT_ROUNDS: e.BCRYPT_ROUNDS,

  // ── Downstream services ──────────────────────────────────────────────────
  services: {
    auth:         e.AUTH_SERVICE_URL,
    email:        e.EMAIL_SERVICE_URL,
    order:        e.ORDER_SERVICE_URL,
    cart:         e.CART_SERVICE_URL,
    wishlist:     e.WISHLIST_SERVICE_URL,
    notification: e.NOTIFICATION_SERVICE_URL,
  },

  // ── CORS ─────────────────────────────────────────────────────────────────
  CORS_ORIGIN: e.CORS_ORIGIN,

  // ── Rate limiting ─────────────────────────────────────────────────────────
  rateLimit: {
    api:  { windowMs: e.RATE_LIMIT_WINDOW_MS,  max: e.RATE_LIMIT_MAX_REQUESTS },
    bulk: { windowMs: e.RATE_LIMIT_WINDOW_MS,  max: e.BULK_RATE_LIMIT_MAX },
  },

  // ── File uploads ──────────────────────────────────────────────────────────
  MAX_FILE_SIZE: e.MAX_FILE_SIZE,
  STORAGE_TYPE:  e.STORAGE_TYPE,

  // ── Logging ─────────────────────────────────────────────────────────────
  LOG_LEVEL:  e.LOG_LEVEL,
  LOG_FORMAT: e.LOG_FORMAT,
};

module.exports = env;
