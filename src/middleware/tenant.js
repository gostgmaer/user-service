'use strict';

const TENANCY_ENABLED = process.env.TENANCY_ENABLED === "true";
const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID?.trim() || "easydev";

/**
 * Resolves req.tenantId from the x-tenant-id request header.
 *
 * Header present  → req.tenantId = header value
 * Header missing  → req.tenantId = DEFAULT_TENANT_ID (or 'default')
 */
function resolveTenantMiddleware(req, res, next) {
  if (!TENANCY_ENABLED) {
		req.tenantId = null;
		return next();
	}

  const tenantId = (req.headers['x-tenant-id'] || '').trim();

  if (tenantId) {
    req.tenantId = tenantId;
    return next();
  }

  if (DEFAULT_TENANT_ID) {
		req.tenantId = DEFAULT_TENANT_ID;
		return next();
	}

  req.tenantId = "easydev";
  next();
}

module.exports = { resolveTenantMiddleware };
