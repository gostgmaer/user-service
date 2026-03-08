'use strict';

const AppError = require('../utils/appError');

const TENANCY_ENABLED   = process.env.TENANCY_ENABLED === 'true';
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID?.trim() || null;

/**
 * Resolves req.tenantId from the x-tenant-id request header.
 *
 * TENANCY_ENABLED=true  + header present        → req.tenantId = header value
 * TENANCY_ENABLED=true  + no header, default set → req.tenantId = DEFAULT_TENANT_ID
 * TENANCY_ENABLED=true  + no header, no default  → 400 AppError
 * TENANCY_ENABLED=false + header present        → req.tenantId = header value
 * TENANCY_ENABLED=false + no header             → req.tenantId = null, continues
 */
function resolveTenantMiddleware(req, res, next) {
  const tenantId = (req.headers['x-tenant-id'] || '').trim();

  if (tenantId) {
    req.tenantId = tenantId;
    return next();
  }

  if (TENANCY_ENABLED) {
    if (DEFAULT_TENANT_ID) {
      req.tenantId = DEFAULT_TENANT_ID;
      return next();
    }
    return next(AppError.badRequest('Missing required header: x-tenant-id', 'MISSING_TENANT_ID'));
  }

  req.tenantId = null;
  next();
}

module.exports = { resolveTenantMiddleware };
