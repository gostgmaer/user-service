// src/middleware/auth.js
// Three-mode authentication middleware:
//   Mode 1 — Bearer JWT   (browser / mobile clients)
//   Mode 2 — x-api-key    (service-to-service)
//   Mode 3 — x-user-context (API-gateway-forwarded user context)
'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const User   = require('../models/User');
const env    = require('../config/env');
const DeviceDetector = require('../services/deviceDetector');
const AppError       = require('../utils/appError');

// ── helpers ──────────────────────────────────────────────────────────────────

// Constant-time comparison to prevent timing attacks on API key checks
const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still run timingSafeEqual to avoid short-circuit timing leak
    crypto.timingSafeEqual(bufA.length > 0 ? bufA : Buffer.from('x'), bufA.length > 0 ? bufA : Buffer.from('x'));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
};

const getAllowedServiceKeys = () => {
  const raw = env.ALLOWED_SERVICE_API_KEYS || '';
  return raw.split(',').map((k) => k.trim()).filter(Boolean);
};

const buildServiceUser = (serviceName) => ({
  _id:        null,
  id:         null,
  role:       'service',
  isActive:   true,
  isDeleted:  false,
  tenantId:   null,
  serviceName,
  isServiceAccount: true,
});

// ── Mode 1: JWT verification ──────────────────────────────────────────────────
const verifyJwt = async (token, tenantId) => {
  const decoded = jwt.verify(token, env.jwt.accessSecret, {
    algorithms: [env.jwt.algorithm || 'HS256'],
    issuer:     env.jwt.issuer,
    audience:   env.jwt.audience,
  });

  const userTenantId = tenantId || decoded.tenantId;
  const user = await User.findOne({
    _id: decoded.sub || decoded.userId,
    tenantId: decoded.tenantId,
    isDeleted: false,
  }).populate({ path: 'role', select: 'name permissions' });
  if (!user) throw AppError.unauthorized('User not found');
  if (tenantId && decoded.tenantId && decoded.tenantId !== tenantId) {
    throw AppError.forbidden('Token tenant mismatch');
  }
  return { user, decoded };
};

// ── Mode 2: API key verification ──────────────────────────────────────────────
const verifyApiKey = (incomingKey) => {
  const allowed = getAllowedServiceKeys();
  for (const key of allowed) {
    if (safeEqual(incomingKey, key)) return true;
  }
  return false;
};

// ── Mode 3: Gateway context ───────────────────────────────────────────────────
const verifyGatewayContext = async (contextHeader, gatewaySecretHeader) => {
  if (!env.TRUST_GATEWAY) return null;

  const expectedSecret = env.GATEWAY_SECRET;
  if (!expectedSecret || !safeEqual(gatewaySecretHeader || '', expectedSecret)) {
    throw AppError.unauthorized('Invalid gateway secret');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(contextHeader, 'base64').toString('utf8'));
  } catch {
    throw AppError.unauthorized('Malformed gateway context');
  }

  if (!payload.id) throw AppError.unauthorized('Gateway context missing user id');

  const user = await User.findOne({ _id: payload.id, isDeleted: false })
    .populate({ path: 'role', select: 'name permissions' });
  if (!user) throw AppError.unauthorized('User not found');
  return user;
};

// ── Main middleware ───────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  try {
    req.deviceInfo = DeviceDetector.detectDevice(req);

    const authHeader    = req.headers.authorization;
    const apiKey        = req.headers['x-api-key'];
    const userContext   = req.headers['x-user-context'];
    const gatewaySecret = req.headers['x-gateway-secret'];

    // ── Mode 3: gateway context ──────────────────────────────────────────
    if (userContext && env.TRUST_GATEWAY) {
      const user = await verifyGatewayContext(userContext, gatewaySecret);
      req.user   = user;
      req.userId = user._id;
      req.tenantId = req.tenantId || user.tenantId;
      return next();
    }

    // ── Mode 2: service API key ──────────────────────────────────────────
    if (apiKey) {
      if (!verifyApiKey(apiKey)) {
        return next(AppError.unauthorized('Invalid API key'));
      }
      const serviceName = req.headers['x-service-name'] || 'unknown-service';
      req.user     = buildServiceUser(serviceName);
      req.userId   = null;
      req.tenantId = req.tenantId || req.headers['x-tenant-id'] || null;
      return next();
    }

    // ── Mode 1: Bearer JWT ───────────────────────────────────────────────
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(AppError.unauthorized('No authentication token provided'));
    }

    const token = authHeader.split(' ')[1];
    if (!token) return next(AppError.unauthorized('Invalid token format'));

    let user, decoded;
    try {
      ({ user, decoded } = await verifyJwt(token, req.tenantId));
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return next(AppError.unauthorized('Token has expired', 'TOKEN_EXPIRED'));
      }
      if (jwtError.isOperational) return next(jwtError);
      return next(AppError.unauthorized('Invalid token'));
    }

    if (!user.isActive || user.status === 'banned') {
      return next(AppError.unauthorized('Account is inactive or banned'));
    }
    if (user.isLocked) {
      return next(AppError.unauthorized('Account is temporarily locked'));
    }
    if (user.status === 'suspended') {
      return next(AppError.forbidden('Account has been suspended'));
    }

    req.user      = user;
    req.userId    = user._id;
    req.sessionId = decoded.sessionId;
    req.tenantId  = req.tenantId || user.tenantId;
    res.locals.user = user;

    return next();
  } catch (err) {
    return next(err.isOperational ? err : AppError.internal('Authentication error'));
  }
};

// Optional auth — populates req.user if valid token present, never rejects
const optionalAuth = async (req, res, next) => {
  req.deviceInfo = DeviceDetector.detectDevice(req);
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  const token = authHeader.split(' ')[1];
  if (!token) return next();

  try {
    const { user, decoded } = await verifyJwt(token, req.tenantId);
    if (user && user.isActive && !user.isDeleted) {
      req.user      = user;
      req.userId    = user._id;
      req.sessionId = decoded.sessionId;
      req.tenantId  = req.tenantId || user.tenantId;
    }
  } catch { /* ignore */ }

  return next();
};

// Service-only guard: rejects anything that isn't a valid API key
const serviceAuthMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || !verifyApiKey(apiKey)) {
    return next(AppError.unauthorized('Service authentication required'));
  }
  const serviceName = req.headers['x-service-name'] || 'unknown-service';
  req.user     = buildServiceUser(serviceName);
  req.tenantId = req.tenantId || req.headers['x-tenant-id'] || null;
  return next();
};

module.exports = { authMiddleware, optionalAuth, serviceAuthMiddleware };
