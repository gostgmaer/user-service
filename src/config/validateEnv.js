// src/config/validateEnv.js
require('dotenv').config();
const Joi = require('joi');

const schema = Joi.object({
  NODE_ENV:    Joi.string().valid('development', 'production', 'test').default('development'),
  PORT:        Joi.number().default(3501),
  MONGO_URI:   Joi.string().required(),

  // JWT — MUST match auth service
  JWT_ACCESS_SECRET:  Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ID_SECRET:      Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRY:  Joi.string().default('1d'),
  JWT_REFRESH_EXPIRY: Joi.string().default('7d'),
  JWT_ID_EXPIRY:      Joi.string().default('30d'),
  JWT_ISSUER:         Joi.string().required(),
  JWT_AUDIENCE:       Joi.string().required(),
  JWT_ALGORITHM:      Joi.string().default('HS256'),

  // Service auth
  SERVICE_NAME:             Joi.string().default('user-service'),
  SERVICE_API_KEY:          Joi.string().optional().allow(''),
  ALLOWED_SERVICE_API_KEYS: Joi.string().optional().allow(''),
  TRUST_GATEWAY:            Joi.string().valid('true','false').default('false'),
  GATEWAY_SECRET:           Joi.string().optional().allow(''),

  // Security
  BCRYPT_ROUNDS:      Joi.number().min(10).max(14).default(12),

  // Redis (optional)
  REDIS_URL: Joi.string().optional().allow(''),

  // Downstream microservice base URLs
  AUTH_SERVICE_URL:         Joi.string().uri().optional().allow('').default('http://localhost:3500'),
  EMAIL_SERVICE_URL:        Joi.string().uri().optional().allow('').default('http://localhost:3502'),
  ORDER_SERVICE_URL:        Joi.string().uri().optional().allow('').default('http://localhost:3503'),
  CART_SERVICE_URL:         Joi.string().uri().optional().allow('').default('http://localhost:3504'),
  WISHLIST_SERVICE_URL:     Joi.string().uri().optional().allow('').default('http://localhost:3505'),
  NOTIFICATION_SERVICE_URL: Joi.string().uri().optional().allow('').default('http://localhost:3506'),

  // CORS
  CORS_ORIGIN: Joi.string().required(),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS:   Joi.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS:Joi.number().default(1000),
  BULK_RATE_LIMIT_MAX:    Joi.number().default(10),

  // File uploads
  MAX_FILE_SIZE: Joi.number().default(10485760),
  STORAGE_TYPE:  Joi.string().valid('local', 's3').default('local'),

  // Logging
  LOG_LEVEL:  Joi.string().valid('error','warn','info','http','debug').default('info'),
  LOG_FORMAT: Joi.string().valid('json','pretty').default('json'),

  TRUST_PROXY: Joi.number().default(1),

  // Tenant configuration
  TENANCY_ENABLED:   Joi.string().valid('true', 'false').default('false'),
  DEFAULT_TENANT_ID: Joi.string().optional().allow(''),
}).unknown(true);

const { error, value } = schema.validate(process.env);
if (error) {
  console.error('❌ Environment validation failed:', error.message);
  process.exit(1);
}

module.exports = value;
