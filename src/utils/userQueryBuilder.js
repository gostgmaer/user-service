// src/utils/userQueryBuilder.js
// Centralises all MongoDB filter and options building for the getUsers endpoint.
'use strict';

const mongoose = require('mongoose');

// Escape regex special characters to prevent ReDoS
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whitelist of fields allowed in ?fields= projection
const ALLOWED_PROJECTION_FIELDS = new Set([
  'firstName','lastName','email','username','phoneNumber','profilePicture',
  'role','isActive','isDeleted','status','emailVerified','isVerified',
  'createdAt','updatedAt','lastLogin','loginCount','loyaltyPoints',
  'referralCode','subscriptionStatus','subscriptionType','preferences',
  'tenantId','registrationSource','socialAccounts','meta','address',
]);

// Whitelist of fields allowed in ?sortBy=
const SORTABLE_FIELDS = new Set([
  'createdAt','updatedAt','lastLogin','loginCount','email','username',
  'firstName','lastName','loyaltyPoints','status','subscriptionStatus',
]);

/**
 * Build a MongoDB filter object from request query params.
 * @param {object} q                - req.query
 * @param {object} requestingUser   - req.user (used for privilege filtering)
 * @returns {object}                - MongoDB filter
 */
function buildUserQuery(q, requestingUser) {
  const filter = {};

  // Soft-delete visibility — admins may request isDeleted=true
  if (q.isDeleted === 'true' && ['super_admin','admin'].includes(requestingUser?.role)) {
    filter.isDeleted = true;
  } else {
    filter.isDeleted = false;
  }

  // Tenant scoping (always scope to the requesting user's tenant)
  if (requestingUser?.tenantId) {
    filter.tenantId = requestingUser.tenantId;
  }

  // Basic fields
  if (q.email)    filter.email    = q.email.toLowerCase().trim();
  if (q.username) filter.username = q.username.trim();
  if (q.phone)    filter.phoneNumber = q.phone.trim();

  // Status
  if (q.status) filter.status = q.status;

  // Boolean flags
  if (q.isVerified !== undefined) filter.isVerified = q.isVerified === 'true';
  if (q.isActive   !== undefined) filter.isActive   = q.isActive === 'true';

  // Role(s) — accepts ObjectId strings since role is now a reference
  if (q.role && mongoose.Types.ObjectId.isValid(q.role)) {
    filter.role = new mongoose.Types.ObjectId(q.role);
  } else if (q.roles) {
    const ids = q.roles.split(',').map((r) => r.trim()).filter((r) => mongoose.Types.ObjectId.isValid(r));
    if (ids.length) filter.role = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
  }

  // Full-text search across key string fields
  if (q.search) {
    const regex = new RegExp(escapeRegex(q.search.trim()), 'i');
    filter.$or = [
      { firstName:   regex },
      { lastName:    regex },
      { email:       regex },
      { username:    regex },
      { phoneNumber: regex },
    ];
  }

  // Date range filters
  const dateFields = {
    createdAfter:    ['createdAt', '$gte'],
    createdBefore:   ['createdAt', '$lte'],
    updatedAfter:    ['updatedAt', '$gte'],
    updatedBefore:   ['updatedAt', '$lte'],
    lastLoginAfter:  ['lastLogin', '$gte'],
    lastLoginBefore: ['lastLogin', '$lte'],
  };

  for (const [param, [field, op]] of Object.entries(dateFields)) {
    if (q[param]) {
      const d = new Date(q[param]);
      if (!isNaN(d)) {
        filter[field] = { ...filter[field], [op]: d };
      }
    }
  }

  // Account age (days)
  if (q.accountAgeMin || q.accountAgeMax) {
    const now = new Date();
    filter.createdAt = filter.createdAt || {};
    if (q.accountAgeMin) {
      filter.createdAt.$lte = new Date(now - parseInt(q.accountAgeMin, 10) * 86400000);
    }
    if (q.accountAgeMax) {
      filter.createdAt.$gte = new Date(now - parseInt(q.accountAgeMax, 10) * 86400000);
    }
  }

  // Registration source
  if (q.registrationSource) filter.registrationSource = q.registrationSource;

  // Social auth
  if (q.hasSocialAuth === 'true')  filter['socialAccounts.0'] = { $exists: true };
  if (q.hasSocialAuth === 'false') filter['socialAccounts.0'] = { $exists: false };
  if (q.socialProvider) filter['socialAccounts.provider'] = q.socialProvider;

  // MFA
  if (q.hasMFA === 'true')  filter['twoFactorAuth.enabled'] = true;
  if (q.hasMFA === 'false') filter['twoFactorAuth.enabled'] = { $ne: true };
  if (q.mfaMethod) filter['twoFactorAuth.method'] = q.mfaMethod;

  // Loyalty
  const loyaltyFilter = {};
  if (q.loyaltyPointsMin) loyaltyFilter.$gte = parseInt(q.loyaltyPointsMin, 10);
  if (q.loyaltyPointsMax) loyaltyFilter.$lte = parseInt(q.loyaltyPointsMax, 10);
  if (Object.keys(loyaltyFilter).length) filter.loyaltyPoints = loyaltyFilter;

  // Geography
  if (q.country)  filter['meta.country']  = q.country.toUpperCase();
  if (q.city)     filter['meta.city']     = new RegExp(escapeRegex(q.city.trim()), 'i');
  if (q.timezone) filter['meta.timezone'] = q.timezone;

  // Login activity
  if (q.hasLoggedIn === 'true')  filter.lastLogin = { $ne: null };
  if (q.hasLoggedIn === 'false') filter.lastLogin = null;
  if (q.loginCountMin || q.loginCountMax) {
    const lc = {};
    if (q.loginCountMin) lc.$gte = parseInt(q.loginCountMin, 10);
    if (q.loginCountMax) lc.$lte = parseInt(q.loginCountMax, 10);
    filter.loginCount = lc;
  }

  // Device type (stored in last login history entry)
  if (q.deviceType) filter['loginHistory.device.type'] = new RegExp(q.deviceType, 'i');

  // Tags (meta.tags array)
  if (q.tags) {
    const tags = q.tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (tags.length) filter['meta.tags'] = { $all: tags };
  }

  return filter;
}

/**
 * Build pagination, sort, and projection options from request query params.
 */
function buildUserQueryOptions(q) {
  const page  = Math.max(1, parseInt(q.page  || '1',  10));
  const limit = Math.min(100, Math.max(1, parseInt(q.limit || '20', 10)));
  const skip  = (page - 1) * limit;

  const rawSort  = SORTABLE_FIELDS.has(q.sortBy) ? q.sortBy : 'createdAt';
  const sortBy   = rawSort;
  const sortOrder = q.sortOrder === 'asc' ? 'asc' : 'desc';

  const cursor = q.cursor && mongoose.Types.ObjectId.isValid(q.cursor)
    ? new mongoose.Types.ObjectId(q.cursor)
    : null;

  let projection = null;
  if (q.fields) {
    const requestedFields = q.fields.split(',').map((f) => f.trim());
    const allowed = requestedFields.filter((f) => ALLOWED_PROJECTION_FIELDS.has(f));
    if (allowed.length > 0) {
      projection = allowed.join(' ');
    }
  }

  return { page, limit, skip, sortBy, sortOrder, cursor, projection };
}

module.exports = { buildUserQuery, buildUserQueryOptions, ALLOWED_PROJECTION_FIELDS, SORTABLE_FIELDS };
