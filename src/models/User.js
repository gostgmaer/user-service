// src/models/User.js
// Comprehensive User schema � shared with auth service (same DB, same collection).
// This model is the single source of truth for the users collection.
'use strict';

const mongoose = require('mongoose');
const { getRoleModel } = require('./roleRef');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const env      = require('../config/env');

const BCRYPT_ROUNDS = env.BCRYPT_ROUNDS || 12;
const MAX_ATTEMPTS  = 5;
const LOCK_WINDOW_MS = 30 * 60 * 1000;

const userSchema = new mongoose.Schema(
  {
    // -- Multi-tenancy -----------------------------------------------------
    tenantId: { type: String, required: true, index: true },

    // -- Identity ---------------------------------------------------------
    username:      { type: String, required: true, trim: true, minlength: 3, maxlength: 30 },
    email:         { type: String, required: true, lowercase: true, trim: true },
    hash_password: { type: String, default: null },

    // -- Profile -----------------------------------------------------------
    firstName:   { type: String, trim: true, default: null },
    lastName:    { type: String, trim: true, default: null },
    dateOfBirth: { type: Date, default: null },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_to_say'],
      default: null,
    },
    phoneNumber:    { type: String, default: null },
    profilePicture: {
      id:   { type: String, default: null },
      url:  { type: String, default: null },
      name: { type: String, default: null },
      size: { type: Number, default: null },
      type: { type: String, default: null },
    },

    // -- Status & Role -----------------------------------------------------
    role:        { type: mongoose.Schema.Types.ObjectId, ref: 'Role', default: null },
    permissions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Permission' }],
    isActive: { type: Boolean, default: true },
    isDeleted:{ type: Boolean, default: false },
    status: {
      type: String,
      enum: ['active', 'inactive', 'pending', 'banned', 'deleted', 'archived', 'draft', 'suspended'],
      default: 'pending',
    },

    // -- Audit -------------------------------------------------------------
    created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deleted_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    deletedAt:  { type: Date, default: null },

    // -- Verification ------------------------------------------------------
    emailVerified: { type: Boolean, default: false },
    phoneVerified: { type: Boolean, default: false },
    isVerified:    { type: Boolean, default: false },
    emailVerificationToken:       { type: String, default: null },
    emailVerificationTokenExpiry: { type: Date,   default: null },

    // -- Password Reset ----------------------------------------------------
    passwordReset: {
      token:       { type: String, default: null },
      tokenExpiry: { type: Date,   default: null },
      attempts:    { type: Number, default: 0 },
      lastAttempt: { type: Date,   default: null },
    },

    // -- Account Unlock ----------------------------------------------------
    unlockToken: {
      token:       { type: String, default: null },
      tokenExpiry: { type: Date,   default: null },
    },

    // -- Login Security ----------------------------------------------------
    loginSecurity: {
      failedAttempts:             { type: Number,  default: 0 },
      lockedUntil:                { type: Date,    default: null },
      lastLoginAttempt:           { type: Date,    default: null },
      consecutiveFailures:        { type: Number,  default: 0 },
      suspiciousActivityDetected: { type: Boolean, default: false },
    },
    lastLogin:    { type: Date, default: null },
    loginHistory: [
      {
        loginTime:     { type: Date,    default: Date.now },
        ipAddress:     { type: String,  default: null },
        userAgent:     { type: String,  default: null },
        successful:    { type: Boolean, required: true },
        failureReason: { type: String,  default: null },
        deviceId:      { type: String,  default: null },
        loginMethod:   { type: String,  enum: ['password','social','otp','sso'], default: 'password' },
        location:      { type: mongoose.Schema.Types.Mixed, default: {} },
        browser:       { type: mongoose.Schema.Types.Mixed, default: {} },
        os:            { type: mongoose.Schema.Types.Mixed, default: {} },
        device:        { type: mongoose.Schema.Types.Mixed, default: {} },
        security:      { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],

    // -- Sessions & Tokens -------------------------------------------------
    activeSessions: [
      {
        sessionId:  { type: String, required: true },
        deviceId:   { type: String, required: true },
        deviceInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
        isActive:   { type: Boolean, default: true },
        createdAt:  { type: Date, default: Date.now },
        expiresAt:  { type: Date, default: null },
        lastActive: { type: Date, default: Date.now },
      },
    ],
    refreshTokens: [
      {
        token:     { type: String, required: true },
        deviceId:  { type: String, default: null },
        isActive:  { type: Boolean, default: true },
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, default: null },
        jti:       { type: String, default: null },
      },
    ],

    // -- OTP / 2FA ---------------------------------------------------------
    currentOTP: {
      code:        { type: String,  default: null },
      hashedCode:  { type: String,  default: null },
      type:        { type: String,  default: null },
      purpose:     { type: String,  default: null },
      expiresAt:   { type: Date,    default: null },
      attempts:    { type: Number,  default: 0 },
      maxAttempts: { type: Number,  default: 5 },
      lastSent:    { type: Date,    default: null },
      verified:    { type: Boolean, default: false },
    },
    twoFactorAuth: {
      enabled:  { type: Boolean, default: false },
      secret:   { type: String,  default: null },
      backupCodes: [
        {
          code:      { type: String,  required: true },
          used:      { type: Boolean, default: false },
          usedAt:    { type: Date,    default: null },
          createdAt: { type: Date,    default: Date.now },
        },
      ],
      setupCompleted: { type: Boolean, default: false },
      lastUsed:       { type: Date,    default: null },
    },

    // -- Devices -----------------------------------------------------------
    knownDevices: [
      {
        deviceId:    { type: String,  required: true },
        name:        { type: String,  default: null },
        type:        { type: String,  default: null },
        os:          { type: String,  default: null },
        browser:     { type: String,  default: null },
        firstSeen:   { type: Date,    default: Date.now },
        lastSeen:    { type: Date,    default: Date.now },
        isTrusted:   { type: Boolean, default: false },
        isActive:    { type: Boolean, default: true },
        fingerprint: { type: String,  default: null },
        ipAddress:   { type: String,  default: null },
        location:    { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],

    // -- Social Accounts ---------------------------------------------------
    socialAccounts: [
      {
        provider:    { type: String, required: true },
        providerId:  { type: String, required: true },
        email:       { type: String, default: null },
        displayName: { type: String, default: null },
        avatar:      { type: String, default: null },
        verified:    { type: Boolean, default: false },
        connectedAt: { type: Date, default: Date.now },
      },
    ],
    socialMedia: {
      facebook:  { type: String, default: null },
      twitter:   { type: String, default: null },
      instagram: { type: String, default: null },
      linkedin:  { type: String, default: null },
      google:    { type: String, default: null },
      pinterest: { type: String, default: null },
    },

    // -- Security Events ---------------------------------------------------
    securityEvents: [
      {
        event:       { type: String, required: true },
        description: { type: String, default: null },
        severity:    { type: String, enum: ['low','medium','high','critical'], default: 'medium' },
        timestamp:   { type: Date,   default: Date.now },
        ipAddress:   { type: String, default: null },
        userAgent:   { type: String, default: null },
        metadata:    { type: mongoose.Schema.Types.Mixed, default: {} },
      },
    ],

    // -- Relationships (e-commerce) ----------------------------------------
    address:          [{ type: mongoose.Schema.Types.ObjectId, ref: 'Address' }],
    favoriteProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    referredBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // -- Preferences -------------------------------------------------------
    preferences: {
      newsletter:    { type: Boolean, default: false },
      notifications: { type: Boolean, default: true },
      language:      { type: String,  default: 'en' },
      currency:      { type: String,  default: 'USD' },
      theme:         { type: String,  enum: ['light','dark','system'], default: 'system' },
    },
    interests: [{ type: String }],

    // -- E-commerce --------------------------------------------------------
    loyaltyPoints:   { type: Number, default: 0 },
    referralCode:    { type: String, default: null },
    paymentMethods:  [{ type: mongoose.Schema.Types.Mixed }],
    shippingPreferences: { type: mongoose.Schema.Types.Mixed, default: {} },
    subscriptionStatus: {
      type: String,
      enum: ['active','inactive','trialing','cancelled','expired'],
      default: 'inactive',
    },
    subscriptionType: { type: String, default: null },

    // -- Org / Classification metadata ------------------------------------
    meta: {
      department:   { type: String, trim: true, default: null },
      division:     { type: String, trim: true, default: null },
      branch:       { type: String, trim: true, default: null },
      team:         { type: String, trim: true, default: null },
      jobTitle:     { type: String, trim: true, default: null },
      employeeId:   { type: String, trim: true, default: null },
      manager:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      startDate:    { type: Date,   default: null },
      category:     { type: String, trim: true, default: null },
      tags:         { type: [String], default: [] },
      customFields: { type: mongoose.Schema.Types.Mixed, default: {} },
    },

    // -- Registration source -----------------------------------------------
    registrationSource: {
      type: String,
      enum: ['email','google','facebook','github','apple','phone'],
      default: 'email',
    },
    loginCount: { type: Number, default: 0 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// -- Indexes ----------------------------------------------------------------
userSchema.index({ tenantId: 1, email: 1 },    { unique: true });
userSchema.index({ tenantId: 1, username: 1 }, { unique: true });
userSchema.index({ tenantId: 1, status: 1 });
userSchema.index({ tenantId: 1, createdAt: -1 });
userSchema.index({ tenantId: 1, role: 1 });
userSchema.index({ tenantId: 1, 'meta.tags': 1 });
userSchema.index({ tenantId: 1, 'socialAccounts.provider': 1, 'socialAccounts.providerId': 1 });

// -- Pre-save: cap unbounded subdocument arrays -----------------------------
userSchema.pre('save', function (next) {
  const now = new Date();
  const MAX_SESSIONS      = 50;
  const MAX_TOKENS        = 50;
  const MAX_DEVICES       = 30;
  const MAX_LOGIN_HISTORY = 100;
  const MAX_SECURITY_LOGS = 100;

  if (this.activeSessions?.length > MAX_SESSIONS) {
    this.activeSessions = this.activeSessions
      .filter((s) => s.isActive && s.expiresAt > now)
      .slice(-MAX_SESSIONS);
  }
  if (this.refreshTokens?.length > MAX_TOKENS) {
    this.refreshTokens = this.refreshTokens
      .filter((t) => t.isActive && t.expiresAt > now)
      .slice(-MAX_TOKENS);
  }
  if (this.knownDevices?.length > MAX_DEVICES) {
    this.knownDevices = this.knownDevices.filter((d) => d.isActive).slice(-MAX_DEVICES);
  }
  if (this.loginHistory?.length > MAX_LOGIN_HISTORY) {
    this.loginHistory = this.loginHistory.slice(-MAX_LOGIN_HISTORY);
  }
  if (this.securityEvents?.length > MAX_SECURITY_LOGS) {
    this.securityEvents = this.securityEvents.slice(-MAX_SECURITY_LOGS);
  }

  next();
});

// -- Virtuals --------------------------------------------------------------
userSchema.virtual('fullName').get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(' ') || this.username;
});

userSchema.virtual('isLocked').get(function () {
  return !!(this.loginSecurity?.lockedUntil && this.loginSecurity.lockedUntil > new Date());
});

userSchema.virtual('hasActiveTOTP').get(function () {
  return !!(this.twoFactorAuth?.enabled && this.twoFactorAuth?.setupCompleted);
});

// -- Instance Methods -------------------------------------------------------
userSchema.methods.comparePassword = function (plain) {
  if (!this.hash_password) return Promise.resolve(false);
  return bcrypt.compare(plain, this.hash_password);
};

userSchema.methods.setPassword = async function (plain) {
  this.hash_password = await bcrypt.hash(plain, BCRYPT_ROUNDS);
};

userSchema.methods.updateLastLogin = async function () {
  this.lastLogin  = new Date();
  this.loginCount = (this.loginCount || 0) + 1;
  return this.save();
};

userSchema.methods.verifyUser = async function () {
  this.isVerified    = true;
  this.emailVerified = true;
  this.status        = 'active';
  return this.save();
};

userSchema.methods.updateProfile = async function (data) {
  const allowed = ['firstName','lastName','dateOfBirth','gender','phoneNumber','profilePicture','socialMedia','interests'];
  allowed.forEach((k) => { if (data[k] !== undefined) this[k] = data[k]; });
  return this.save();
};

userSchema.methods.updatePreferences = async function (data) {
  Object.assign(this.preferences, data);
  return this.save();
};

userSchema.methods.addLoyaltyPoints = async function (points) {
  this.loyaltyPoints = (this.loyaltyPoints || 0) + points;
  return this.save();
};

userSchema.methods.redeemLoyaltyPoints = async function (points) {
  if (this.loyaltyPoints < points) throw new Error('Insufficient loyalty points');
  this.loyaltyPoints -= points;
  return this.save();
};

userSchema.methods.addFavoriteProduct = async function (productId) {
  const pid = String(productId);
  if (!this.favoriteProducts.map(String).includes(pid)) {
    this.favoriteProducts.push(productId);
    return this.save();
  }
  return this;
};

userSchema.methods.removeFavoriteProduct = async function (productId) {
  const pid = String(productId);
  this.favoriteProducts = this.favoriteProducts.filter((p) => String(p) !== pid);
  return this.save();
};

userSchema.methods.logSecurityEvent = async function (event, description, severity = 'medium', meta = {}) {
  this.securityEvents.push({ event, description, severity, metadata: meta, timestamp: new Date() });
  if (this.securityEvents.length > 100) this.securityEvents = this.securityEvents.slice(-100);
  return this.save();
};

userSchema.methods.incrementFailedLogin = async function () {
  this.loginSecurity.failedAttempts      = (this.loginSecurity.failedAttempts || 0) + 1;
  this.loginSecurity.consecutiveFailures = (this.loginSecurity.consecutiveFailures || 0) + 1;
  this.loginSecurity.lastLoginAttempt    = new Date();
  if (this.loginSecurity.failedAttempts >= MAX_ATTEMPTS) {
    this.loginSecurity.lockedUntil = new Date(Date.now() + LOCK_WINDOW_MS);
  }
  return this.save();
};

userSchema.methods.resetFailedLogin = async function () {
  this.loginSecurity.failedAttempts      = 0;
  this.loginSecurity.consecutiveFailures = 0;
  this.loginSecurity.lockedUntil         = null;
  this.lastLogin  = new Date();
  this.loginCount = (this.loginCount || 0) + 1;
  return this.save();
};

// -- Static Methods --------------------------------------------------------
userSchema.statics.findByEmail = function (tenantId, email) {
  return this.findOne({ tenantId, email: email.toLowerCase(), isDeleted: false });
};

userSchema.statics.findByUsername = function (tenantId, username) {
  return this.findOne({ tenantId, username, isDeleted: false });
};

userSchema.statics.getAdmins = async function (tenantId) {
  const Role = getRoleModel();
  const roles = await Role.find({ tenantId, name: { $in: ['admin','super_admin'] }, isActive: true });
  const roleIds = roles.map((r) => r._id);
  return this.find({ tenantId, role: { $in: roleIds }, isDeleted: false }).populate({ path: 'role', select: 'name' });
};

userSchema.statics.getCustomers = async function (tenantId) {
  const Role = getRoleModel();
  const role = await Role.findOne({ tenantId, name: 'customer', isActive: true });
  if (!role) return [];
  return this.find({ tenantId, role: role._id, isDeleted: false }).populate({ path: 'role', select: 'name' });
};

userSchema.statics.registerNewUser = async function (data, tenantId) {
  const { email, username, password, ...rest } = data;
  const hash_password = password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : undefined;
  return this.create({
    tenantId,
    email: email.toLowerCase(),
    username: username || email.split('@')[0],
    ...(hash_password !== undefined && { hash_password }),
    status: 'pending',
    ...rest,
  });
};

/**
 * Paginated user list.
 * @param {object} opts.query       - MongoDB filter object
 * @param {number} opts.page        - 1-based page number
 * @param {number} opts.limit       - results per page (max 100)
 * @param {number} opts.skip        - computed skip offset
 * @param {string} opts.sortBy      - field to sort on
 * @param {string} opts.sortOrder   - 'asc' | 'desc'
 * @param {string} opts.cursor      - last-seen _id for cursor paging
 * @param {object} opts.projection  - field projection
 * @param {Array}  opts.populate    - populate options
 */
userSchema.statics.getPaginatedUsers = async function ({
  query   = {},
  page    = 1,
  limit   = 20,
  skip    = 0,
  sortBy  = 'createdAt',
  sortOrder = 'desc',
  cursor  = null,
  projection = null,
  populate   = [],
}) {
  const safeLimit = Math.min(limit, 100);
  const finalQuery = { ...query };

  if (cursor) {
    finalQuery._id = sortOrder === 'desc' ? { $lt: cursor } : { $gt: cursor };
  }

  const sortDir = sortOrder === 'asc' ? 1 : -1;
  const sort    = { [sortBy]: sortDir, _id: sortDir };

  let q = this.find(finalQuery);
  if (projection) q = q.select(projection);
  if (populate.length) q = q.populate(populate);

  const [data, total] = await Promise.all([
    q.sort(sort).skip(cursor ? 0 : skip).limit(safeLimit).lean(),
    this.countDocuments(finalQuery),
  ]);

  const totalPages  = Math.ceil(total / safeLimit);
  const nextCursor  = data.length === safeLimit ? data[data.length - 1]._id : null;

  return { data, total, page, limit: safeLimit, totalPages, nextCursor };
};

// -- All-in-one stats (single-call for the analytics dashboard) --------------
userSchema.statics.getAllTableStats = async function (opts = {}) {
  const tenantId     = opts.tenantId;
  const trendDays    = parseInt(opts.trendDays,    10) || 30;
  const interestLimit = parseInt(opts.interestLimit, 10) || 10;
  const topUsersLimit = parseInt(opts.topUsersLimit, 10) || 5;
  const now = new Date();
  const since = (days) => new Date(now - days * 86_400_000);

  const base    = { isDeleted: false, ...(tenantId ? { tenantId } : {}) };
  const trendFrom = since(trendDays);

  // settle() keeps one failure from aborting the whole response
  const settle = (p) => p.then((v) => v).catch(() => null);

  const [
    // -- Counts -----------------------------------------------------------
    totalUsers, activeUsers, inactiveUsers, pendingUsers,
    bannedUsers, deletedUsers, suspendedUsers,
    verifiedUsers, emailVerified, phoneVerified,
    twoFactorEnabled, newsletterSubscribed, notificationsEnabled,
    neverLoggedIn,
    // -- Growth -----------------------------------------------------------
    newToday, newLast7d, newLast30d,
    // -- Login activity ---------------------------------------------------
    loginLast24h, loginLast7d, loginLast30d,
    // -- Group-by aggregations ---------------------------------------------
    byRole, byStatus, bySubscriptionType, bySubscriptionStatus,
    byCountry, byGender, byLanguage, byTheme,
    // -- Security flags ----------------------------------------------------
    accountSecurityStats,
    securityLoginStats,
    // -- Commerce & profile ------------------------------------------------
    loyaltyStats, loyaltyBrackets, topLoyalUsers,
    topInterests,
    socialProviderStats,
    paymentMethodStats,
    profileCompletenessStats,
    // -- Sessions ---------------------------------------------------------
    sessionStats,
    // -- Devices ----------------------------------------------------------
    byDeviceType,
    // -- Trend series -----------------------------------------------------
    registrationTrend, loginTrend,
    // -- Registration source & login behaviour -----------------------------
    byRegistrationSource, loginCountStats, loginMethodDistribution,
    // -- Preference extras -------------------------------------------------
    byCurrency,
    // -- Org / meta --------------------------------------------------------
    byDepartment, byJobTitle, topMetaTags,
    // -- Social media links ------------------------------------------------
    socialMediaLinkStats,
    // -- Security events ---------------------------------------------------
    securityEventStats,
    // -- Devices (OS / browser) ---------------------------------------------
    deviceOsStats, deviceBrowserStats, trustedDeviceStats,
    // -- Referrals & favourites --------------------------------------------
    referralStats,
  ] = await Promise.all([
    // counts
    settle(this.countDocuments(base)),
    settle(this.countDocuments({ ...base, status: 'active' })),
    settle(this.countDocuments({ ...base, status: 'inactive' })),
    settle(this.countDocuments({ ...base, status: 'pending' })),
    settle(this.countDocuments({ ...base, status: 'banned' })),
    settle(this.countDocuments({ ...base, status: 'deleted' })),
    settle(this.countDocuments({ ...base, status: 'suspended' })),
    settle(this.countDocuments({ ...base, isVerified: true })),
    settle(this.countDocuments({ ...base, emailVerified: true })),
    settle(this.countDocuments({ ...base, phoneVerified: true })),
    settle(this.countDocuments({ ...base, 'twoFactorAuth.enabled': true })),
    settle(this.countDocuments({ ...base, 'preferences.newsletter': true })),
    settle(this.countDocuments({ ...base, 'preferences.notifications': true })),
    settle(this.countDocuments({ ...base, $or: [{ lastLogin: null }, { lastLogin: { $exists: false } }] })),
    // growth
    settle(this.countDocuments({ ...base, createdAt: { $gte: since(1) } })),
    settle(this.countDocuments({ ...base, createdAt: { $gte: since(7) } })),
    settle(this.countDocuments({ ...base, createdAt: { $gte: since(30) } })),
    // login activity
    settle(this.countDocuments({ ...base, lastLogin: { $gte: since(1) } })),
    settle(this.countDocuments({ ...base, lastLogin: { $gte: since(7) } })),
    settle(this.countDocuments({ ...base, lastLogin: { $gte: since(30) } })),
    // group-by role
    settle(this.aggregate([
      { $match: base },
      { $lookup: { from: 'roles', localField: 'role', foreignField: '_id', as: 'roleDoc' } },
      { $group: { _id: { $ifNull: [{ $arrayElemAt: ['$roleDoc.name', 0] }, 'unassigned'] }, count: { $sum: 1 } } },
      { $project: { role: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // group-by status
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { status: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // group-by subscriptionType
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: ['$subscriptionType', 'none'] }, count: { $sum: 1 } } },
      { $project: { type: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // group-by subscriptionStatus
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: ['$subscriptionStatus', 'inactive'] }, count: { $sum: 1 } } },
      { $project: { status: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // group-by country (from loginHistory or meta)
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: [{ $arrayElemAt: ['$loginHistory.location.country', -1] }, 'unknown'] }, count: { $sum: 1 } } },
      { $project: { country: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }, { $limit: 20 },
    ])),
    // group-by gender
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: ['$gender', 'not_set'] }, count: { $sum: 1 } } },
      { $project: { gender: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // top languages
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: ['$preferences.language', 'en'] }, count: { $sum: 1 } } },
      { $project: { language: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }, { $limit: 10 },
    ])),
    // theme split
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: ['$preferences.theme', 'system'] }, count: { $sum: 1 } } },
      { $project: { theme: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // security flags (single $group)
    settle(this.aggregate([
      { $match: base },
      { $group: {
        _id: null,
        lockedAccounts:           { $sum: { $cond: [{ $gt: ['$loginSecurity.lockedUntil', now] }, 1, 0] } },
        suspiciousActivityCount:  { $sum: { $cond: ['$loginSecurity.suspiciousActivityDetected', 1, 0] } },
        usersWithFailedAttempts:  { $sum: { $cond: [{ $gt: ['$loginSecurity.failedAttempts', 0] }, 1, 0] } },
        avgFailedAttempts:        { $avg: '$loginSecurity.failedAttempts' },
        twoFactorSetupCompleted:  { $sum: { $cond: ['$twoFactorAuth.setupCompleted', 1, 0] } },
        usersWithBackupCodes:     { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$twoFactorAuth.backupCodes', []] } }, 0] }, 1, 0] } },
      }},
      { $project: { _id: 0 } },
    ])),
    // login success/failure stats from loginHistory
    settle(this.aggregate([
      { $match: { ...base, 'loginHistory.loginTime': { $gte: trendFrom } } },
      { $unwind: '$loginHistory' },
      { $match: { 'loginHistory.loginTime': { $gte: trendFrom } } },
      { $group: {
        _id: null,
        totalLoginEvents:    { $sum: 1 },
        successfulLogins:    { $sum: { $cond: ['$loginHistory.successful', 1, 0] } },
        failedLogins:        { $sum: { $cond: ['$loginHistory.successful', 0, 1] } },
        uniqueActiveUsers:   { $addToSet: '$_id' },
        loginMethods:        { $push: '$loginHistory.loginMethod' },
      }},
      { $project: {
        _id: 0,
        totalLoginEvents: 1, successfulLogins: 1, failedLogins: 1,
        uniqueActiveUsers: { $size: '$uniqueActiveUsers' },
        successRate: { $round: [{ $multiply: [{ $cond: [{ $gt: ['$totalLoginEvents', 0] }, { $divide: ['$successfulLogins', '$totalLoginEvents'] }, 0] }, 100] }, 2] },
      }},
    ])),
    // loyalty stats
    settle(this.aggregate([
      { $match: base },
      { $group: {
        _id: null,
        avgLoyaltyPoints:  { $avg: '$loyaltyPoints' },
        maxLoyaltyPoints:  { $max: '$loyaltyPoints' },
        totalLoyaltyPool:  { $sum: '$loyaltyPoints' },
        usersWithPoints:   { $sum: { $cond: [{ $gt: ['$loyaltyPoints', 0] }, 1, 0] } },
      }},
      { $project: { _id: 0, avgLoyaltyPoints: { $round: ['$avgLoyaltyPoints', 2] }, maxLoyaltyPoints: 1, totalLoyaltyPool: 1, usersWithPoints: 1 } },
    ])),
    // loyalty brackets
    settle(this.aggregate([
      { $match: base },
      { $bucket: { groupBy: '$loyaltyPoints', boundaries: [0, 100, 500, 1000, 5000, Infinity], default: 'other', output: { count: { $sum: 1 } } } },
      { $project: { bracket: '$_id', count: 1, _id: 0 } },
    ])),
    // top loyal users
    settle(this.find({ ...base }).sort({ loyaltyPoints: -1 }).limit(topUsersLimit).select('username email firstName lastName loyaltyPoints status').lean()),
    // top interests
    settle(this.aggregate([
      { $match: base },
      { $unwind: { path: '$interests', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$interests', count: { $sum: 1 } } },
      { $project: { interest: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }, { $limit: interestLimit },
    ])),
    // social provider linkage
    settle(this.aggregate([
      { $match: base },
      { $unwind: { path: '$socialAccounts', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$socialAccounts.provider', uniqueUsers: { $addToSet: '$_id' } } },
      { $project: { provider: '$_id', count: { $size: '$uniqueUsers' }, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // payment method stats
    settle(this.aggregate([
      { $match: base },
      { $project: {
        hasPaymentMethod: { $gt: [{ $size: { $ifNull: ['$paymentMethods', []] } }, 0] },
      }},
      { $group: {
        _id: null,
        withPaymentMethod:    { $sum: { $cond: ['$hasPaymentMethod', 1, 0] } },
        withoutPaymentMethod: { $sum: { $cond: ['$hasPaymentMethod', 0, 1] } },
      }},
      { $project: { _id: 0 } },
    ])),
    // profile completeness
    settle(this.aggregate([
      { $match: base },
      { $group: {
        _id: null,
        withFirstName:      { $sum: { $cond: [{ $and: [{ $ne: ['$firstName',           null] }, { $ne: ['$firstName',           ''] }] }, 1, 0] } },
        withLastName:       { $sum: { $cond: [{ $and: [{ $ne: ['$lastName',            null] }, { $ne: ['$lastName',            ''] }] }, 1, 0] } },
        withPhone:          { $sum: { $cond: [{ $and: [{ $ne: ['$phoneNumber',         null] }, { $ne: ['$phoneNumber',         ''] }] }, 1, 0] } },
        withAvatar:         { $sum: { $cond: [{ $and: [{ $ne: ['$profilePicture.url',  null] }, { $ne: ['$profilePicture.url',  ''] }] }, 1, 0] } },
        withAddress:        { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$address',         []] } }, 0] }, 1, 0] } },
        withInterests:      { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$interests',        []] } }, 0] }, 1, 0] } },
        withSocialAccounts: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$socialAccounts',   []] } }, 0] }, 1, 0] } },
        withReferralCode:   { $sum: { $cond: [{ $and: [{ $ne: ['$referralCode', null] }, { $ne: ['$referralCode', ''] }] }, 1, 0] } },
      }},
      { $project: { _id: 0 } },
    ])),
    // active session stats
    settle(this.aggregate([
      { $match: base },
      { $project: { sessionCount: { $size: { $filter: { input: { $ifNull: ['$activeSessions', []] }, cond: '$$this.isActive' } } } } },
      { $group: {
        _id: null,
        totalActiveSessions: { $sum: '$sessionCount' },
        usersWithActiveSessions: { $sum: { $cond: [{ $gt: ['$sessionCount', 0] }, 1, 0] } },
        usersWithMultipleSessions: { $sum: { $cond: [{ $gt: ['$sessionCount', 1] }, 1, 0] } },
        avgSessionsPerUser: { $avg: '$sessionCount' },
      }},
      { $project: { _id: 0, totalActiveSessions: 1, usersWithActiveSessions: 1, usersWithMultipleSessions: 1, avgSessionsPerUser: { $round: ['$avgSessionsPerUser', 2] } } },
    ])),
    // device type breakdown
    settle(this.aggregate([
      { $match: base },
      { $unwind: { path: '$knownDevices', preserveNullAndEmptyArrays: false } },
      { $match: { 'knownDevices.isActive': true } },
      { $group: { _id: { $ifNull: ['$knownDevices.type', 'unknown'] }, count: { $sum: 1 } } },
      { $project: { deviceType: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // registration trend (last trendDays days, grouped by day)
    settle(this.aggregate([
      { $match: { ...base, createdAt: { $gte: trendFrom } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      }},
      { $project: { date: '$_id', count: 1, _id: 0 } },
      { $sort: { date: 1 } },
    ])),
    // login activity trend (last trendDays days, grouped by day)
    settle(this.aggregate([
      { $match: { ...base, lastLogin: { $gte: trendFrom } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$lastLogin' } },
        count: { $sum: 1 },
      }},
      { $project: { date: '$_id', count: 1, _id: 0 } },
      { $sort: { date: 1 } },
    ])),
    // registration source breakdown
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: ['$registrationSource', 'email'] }, count: { $sum: 1 } } },
      { $project: { source: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // login count stats (avg / max / total / power-users)
    settle(this.aggregate([
      { $match: base },
      { $group: {
        _id: null,
        avgLoginCount:      { $avg: '$loginCount' },
        maxLoginCount:      { $max: '$loginCount' },
        totalLogins:        { $sum: '$loginCount' },
        neverLoggedInCount: { $sum: { $cond: [{ $eq:  ['$loginCount', 0]   }, 1, 0] } },
        powerUsers:         { $sum: { $cond: [{ $gte: ['$loginCount', 100] }, 1, 0] } },
      }},
      { $project: { _id: 0, avgLoginCount: { $round: ['$avgLoginCount', 2] }, maxLoginCount: 1, totalLogins: 1, neverLoggedInCount: 1, powerUsers: 1 } },
    ])),
    // login method distribution (from loginHistory)
    settle(this.aggregate([
      { $match: base },
      { $unwind: { path: '$loginHistory', preserveNullAndEmptyArrays: false } },
      { $group: { _id: { $ifNull: ['$loginHistory.loginMethod', 'unknown'] }, count: { $sum: 1 } } },
      { $project: { method: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // currency preference breakdown
    settle(this.aggregate([
      { $match: base },
      { $group: { _id: { $ifNull: ['$preferences.currency', 'USD'] }, count: { $sum: 1 } } },
      { $project: { currency: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }, { $limit: 20 },
    ])),
    // top departments
    settle(this.aggregate([
      { $match: { ...base, 'meta.department': { $nin: [null, ''] } } },
      { $group: { _id: '$meta.department', count: { $sum: 1 } } },
      { $project: { department: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }, { $limit: 20 },
    ])),
    // top job titles
    settle(this.aggregate([
      { $match: { ...base, 'meta.jobTitle': { $nin: [null, ''] } } },
      { $group: { _id: '$meta.jobTitle', count: { $sum: 1 } } },
      { $project: { jobTitle: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }, { $limit: 20 },
    ])),
    // top meta tags
    settle(this.aggregate([
      { $match: { ...base, 'meta.tags': { $exists: true, $not: { $size: 0 } } } },
      { $unwind: { path: '$meta.tags', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$meta.tags', count: { $sum: 1 } } },
      { $project: { tag: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } }, { $limit: interestLimit },
    ])),
    // social media link stats (per-platform counts)
    settle(this.aggregate([
      { $match: base },
      { $group: {
        _id: null,
        withFacebook:  { $sum: { $cond: [{ $and: [{ $ne: ['$socialMedia.facebook',  null] }, { $ne: ['$socialMedia.facebook',  ''] }] }, 1, 0] } },
        withTwitter:   { $sum: { $cond: [{ $and: [{ $ne: ['$socialMedia.twitter',   null] }, { $ne: ['$socialMedia.twitter',   ''] }] }, 1, 0] } },
        withInstagram: { $sum: { $cond: [{ $and: [{ $ne: ['$socialMedia.instagram', null] }, { $ne: ['$socialMedia.instagram', ''] }] }, 1, 0] } },
        withLinkedin:  { $sum: { $cond: [{ $and: [{ $ne: ['$socialMedia.linkedin',  null] }, { $ne: ['$socialMedia.linkedin',  ''] }] }, 1, 0] } },
        withGoogle:    { $sum: { $cond: [{ $and: [{ $ne: ['$socialMedia.google',    null] }, { $ne: ['$socialMedia.google',    ''] }] }, 1, 0] } },
        withPinterest: { $sum: { $cond: [{ $and: [{ $ne: ['$socialMedia.pinterest', null] }, { $ne: ['$socialMedia.pinterest', ''] }] }, 1, 0] } },
      }},
      { $project: { _id: 0 } },
    ])),
    // security event severity breakdown
    settle(this.aggregate([
      { $match: base },
      { $unwind: { path: '$securityEvents', preserveNullAndEmptyArrays: false } },
      { $group: { _id: '$securityEvents.severity', count: { $sum: 1 } } },
      { $project: { severity: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // device OS breakdown (active known devices)
    settle(this.aggregate([
      { $match: base },
      { $unwind: { path: '$knownDevices', preserveNullAndEmptyArrays: false } },
      { $match: { 'knownDevices.isActive': true } },
      { $group: { _id: { $ifNull: ['$knownDevices.os', 'unknown'] }, count: { $sum: 1 } } },
      { $project: { os: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // device browser breakdown (active known devices)
    settle(this.aggregate([
      { $match: base },
      { $unwind: { path: '$knownDevices', preserveNullAndEmptyArrays: false } },
      { $match: { 'knownDevices.isActive': true } },
      { $group: { _id: { $ifNull: ['$knownDevices.browser', 'unknown'] }, count: { $sum: 1 } } },
      { $project: { browser: '$_id', count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ])),
    // trusted device stats
    settle(this.aggregate([
      { $match: base },
      { $project: {
        trustedCount: { $size: { $filter: { input: { $ifNull: ['$knownDevices', []] }, cond: '$$this.isTrusted' } } },
        totalCount:   { $size: { $ifNull: ['$knownDevices', []] } },
      }},
      { $group: {
        _id: null,
        usersWithTrustedDevices: { $sum: { $cond: [{ $gt: ['$trustedCount', 0] }, 1, 0] } },
        totalTrustedDevices:     { $sum: '$trustedCount' },
        totalKnownDevices:       { $sum: '$totalCount' },
        avgDevicesPerUser:       { $avg: '$totalCount' },
      }},
      { $project: { _id: 0, usersWithTrustedDevices: 1, totalTrustedDevices: 1, totalKnownDevices: 1, avgDevicesPerUser: { $round: ['$avgDevicesPerUser', 2] } } },
    ])),
    // referral & favourites stats
    settle(this.aggregate([
      { $match: base },
      { $group: {
        _id: null,
        usersWithReferralCode: { $sum: { $cond: [{ $and: [{ $ne: ['$referralCode', null] }, { $ne: ['$referralCode', ''] }] }, 1, 0] } },
        usersWhoWereReferred:  { $sum: { $cond: [{ $ne: ['$referredBy', null] }, 1, 0] } },
        usersWithFavorites:    { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$favoriteProducts', []] } }, 0] }, 1, 0] } },
        avgFavoriteProducts:   { $avg: { $size: { $ifNull: ['$favoriteProducts', []] } } },
      }},
      { $project: { _id: 0, usersWithReferralCode: 1, usersWhoWereReferred: 1, usersWithFavorites: 1, avgFavoriteProducts: { $round: ['$avgFavoriteProducts', 2] } } },
    ])),
  ]);

  return {
    generatedAt: new Date(),
    trendDays,

    // -- User counts ---------------------------------------------------
    counts: {
      total: totalUsers, active: activeUsers, inactive: inactiveUsers,
      pending: pendingUsers, banned: bannedUsers, deleted: deletedUsers, suspended: suspendedUsers,
      verified: verifiedUsers, emailVerified, phoneVerified,
      twoFactorEnabled, newsletterSubscribed, notificationsEnabled, neverLoggedIn,
    },

    // -- Growth --------------------------------------------------------
    growth: { newToday, newLast7d, newLast30d },

    // -- Login activity ------------------------------------------------
    loginActivity: { loginLast24h, loginLast7d, loginLast30d },

    // -- Distributions ------------------------------------------------
    byRole, byStatus, bySubscriptionType, bySubscriptionStatus,
    byCountry, byGender, byLanguage, byTheme, byDeviceType,

    // -- Security -----------------------------------------------------
    accountSecurityStats: accountSecurityStats?.[0] ?? null,
    securityLoginStats:   securityLoginStats?.[0] ?? null,

    // -- Loyalty & commerce --------------------------------------------
    loyaltyStats:     loyaltyStats?.[0] ?? null,
    loyaltyBrackets,
    topLoyalUsers,
    topInterests,
    socialProviderStats,
    paymentMethodStats:   paymentMethodStats?.[0] ?? null,

    // -- Preferences --------------------------------------------------
    profileCompletenessStats: profileCompletenessStats?.[0] ?? null,

    // -- Sessions & devices --------------------------------------------
    sessionStats: sessionStats?.[0] ?? null,

    // -- Trends -------------------------------------------------------
    registrationTrend, loginTrend,

    // -- Registration source & login behaviour ------------------------
    byRegistrationSource,
    loginCountStats:        loginCountStats?.[0]     ?? null,
    loginMethodDistribution,

    // -- Preference extras ---------------------------------------------
    byCurrency,

    // -- Org metadata -------------------------------------------------
    byDepartment, byJobTitle, topMetaTags,

    // -- Social media links --------------------------------------------
    socialMediaLinkStats:   socialMediaLinkStats?.[0] ?? null,

    // -- Security events -----------------------------------------------
    securityEventStats,

    // -- Devices (OS / browser) ----------------------------------------
    deviceOsStats, deviceBrowserStats,
    trustedDeviceStats:     trustedDeviceStats?.[0]  ?? null,

    // -- Referrals & favourites ----------------------------------------
    referralStats:          referralStats?.[0]       ?? null,
  };
};

const User = mongoose.model('User', userSchema);

/**
 * Resolve a user reference to the best available display label.
 * Priority: "First Last" → username → email → id string
 */
function resolveUserRef(ref) {
  if (!ref) return null;
  if (ref !== null && typeof ref === 'object' && !ref._bsontype) {
    const fullName = [ref.firstName, ref.lastName].filter(Boolean).join(' ').trim();
    if (fullName)   return fullName;
    if (ref.username) return ref.username;
    if (ref.email)    return ref.email;
    return String(ref._id ?? ref.id);
  }
  return String(ref);
}

/**
 * Returns a safe API shape with actor refs resolved to display names.
 * Requires the doc to be populated: .populate('created_by updated_by deleted_by', 'firstName lastName username email')
 */
userSchema.methods.toAPIResponse = function () {
  const obj = this.toObject();
  // Strip sensitive and internal fields
  const STRIP = new Set([
    'hash_password', 'refreshTokens', 'passwordReset', 'unlockToken',
    'currentOTP', 'twoFactorAuth', 'activeSessions', 'loginHistory',
    'securityEvents', 'knownDevices', 'emailVerificationToken',
    'emailVerificationTokenExpiry', '__v', 'isDeleted', 'deletedAt',
    'created_by', 'updated_by', 'deleted_by',
  ]);
  for (const k of STRIP) delete obj[k];
  // Resolve role to name string
  if (obj.role && typeof obj.role === 'object' && obj.role.name) obj.role = obj.role.name;
  // Resolve actor refs to display names
  obj.createdBy = resolveUserRef(this.created_by);
  obj.updatedBy = resolveUserRef(this.updated_by);
  obj.deletedBy = resolveUserRef(this.deleted_by);
  return obj;
};

module.exports = User;
