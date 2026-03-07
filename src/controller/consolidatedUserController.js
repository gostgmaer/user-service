// src/controller/consolidatedUserController.js
// Class-based controller — all methods are static async, wrapped in catchAsync.
'use strict';

const mongoose = require('mongoose');

const User     = require('../models/User');
const Address  = require('../models/Address');
const { catchAsync }   = require('../middleware/errorHandler');
const AppError         = require('../utils/appError');
const { sendSuccess, sendCreated, sendError, sendPaginated, sendNoContent } = require('../utils/responseHelper');
const { buildUserQuery, buildUserQueryOptions } = require('../utils/userQueryBuilder');
const { checkPasswordStrength }  = require('../utils/security');
const userEmails                 = require('../lib/userEmails');
const ActivityHelper             = require('../services/activityHelpers');
const env                        = require('../config/env');

// ── Helpers ───────────────────────────────────────────────────────────────────

// role is populated (object with .name) after auth middleware
const isAdmin = (user) => user && ['super_admin','admin'].includes(user.role?.name);
const isOwnerOrAdmin = (req, targetId) =>
  isAdmin(req.user) || String(req.user._id) === String(targetId);

// Build a safe public/admin representation of a user document
const enrichUser = (user, includeCalc = true) => {
  const plain = typeof user.toObject === 'function' ? user.toObject() : { ...user };

  if (!includeCalc) return plain;

  plain.fullName              = user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim();
  plain.userScore             = UserController.calculateUserScore(user);
  plain.activityLevel         = UserController.getUserActivityLevel(user);
  plain.profileCompleteness   = UserController.calculateProfileCompleteness(user);
  plain.securityScore         = UserController.calculateSecurityScore(user);

  return plain;
};

// Strip sensitive fields before sending user data to the client
const sanitizeUser = (user) => {
  const obj = typeof user.toObject === 'function' ? user.toObject() : { ...user };
  delete obj.hash_password;
  delete obj.refreshTokens;
  delete obj.passwordReset;
  delete obj.unlockToken;
  delete obj.currentOTP;
  delete obj.twoFactorAuth?.secret;
  delete obj.__v;
  return obj;
};

// ── Controller class ──────────────────────────────────────────────────────────

class UserController {

  // ── CRUD ──────────────────────────────────────────────────────────────────

  /** GET /api/users  — list users with advanced filtering */
  static getUsers = catchAsync(async (req, res) => {
    const filter  = buildUserQuery(req.query, req.user);
    const options = buildUserQueryOptions(req.query);
    const result  = await User.getPaginatedUsers({ query: filter, ...options });

    return sendPaginated(
      res,
      'Users retrieved successfully',
      result.data.map((u) => sanitizeUser(u)),
      result.total,
      result.page,
      result.limit,
      { totalPages: result.totalPages, nextCursor: result.nextCursor }
    );
  });

  /** GET /api/users/:identifier  — get one user by MongoId */
  static getUserByIdentifier = catchAsync(async (req, res) => {
    const { identifier } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;

    let user;
    if (mongoose.Types.ObjectId.isValid(identifier)) {
      user = await User.findOne({ _id: identifier, tenantId, isDeleted: false });
    } else if (identifier.includes('@')) {
      user = await User.findByEmail(tenantId, identifier);
    } else {
      user = await User.findByUsername(tenantId, identifier);
    }

    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, user._id)) throw AppError.forbidden('Access denied');

    return sendSuccess(res, 'User retrieved', sanitizeUser(enrichUser(user)));
  });

  /** POST /api/users  — admin creates a user */
  static createUser = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const { email, username, ...rest } = req.body;

    if (!email) throw AppError.badRequest('Email is required');

    const exists = await User.findOne({
      tenantId,
      $or: [{ email: email.toLowerCase() }, ...(username ? [{ username }] : [])],
      isDeleted: false,
    });
    if (exists) throw AppError.conflict('Email or username already in use');

    const user = await User.registerNewUser({ email, username, ...rest }, tenantId);
    user.created_by = req.userId;
    if (isAdmin(req.user)) {
      user.status = rest.status || 'active';
      user.isVerified = true;
      user.emailVerified = true;
    }
    await user.save();

    ActivityHelper.logCRUD(req, 'User', 'CREATE', { id: user._id });

    await userEmails.emailUserInvite(user);

    return sendCreated(res, 'User created successfully', sanitizeUser(user));
  });

  /** PUT/PATCH /api/users/:id  — update a user */
  static updateUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw AppError.badRequest('Invalid user ID');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    // Fields only admins may change
    const adminOnlyFields = ['role','status','isActive','isVerified','emailVerified','tenantId'];
    const updateData = { ...req.body };

    if (!isAdmin(req.user)) {
      adminOnlyFields.forEach((f) => delete updateData[f]);
    }

    // Block password change through this endpoint
    delete updateData.hash_password;
    delete updateData.password;

    Object.assign(user, updateData);
    user.updated_by = req.userId;
    await user.save();

    ActivityHelper.logCRUD(req, 'User', 'UPDATE', { id });

    return sendSuccess(res, 'User updated successfully', sanitizeUser(user));
  });

  /** DELETE /api/users/:id  — soft delete */
  static deleteUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) throw AppError.badRequest('Invalid user ID');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    const deletedEmail    = user.email;
    const deletedSnapshot = { email: deletedEmail, firstName: user.firstName, username: user.username };
    user.isDeleted  = true;
    user.status     = 'deleted';
    user.deleted_by = req.userId;
    user.deletedAt  = new Date();
    await user.save();

    ActivityHelper.logCRUD(req, 'User', 'DELETE', { id });

    await userEmails.emailAccountDeleted(deletedSnapshot);

    return sendNoContent(res);
  });

  // ── Profile ───────────────────────────────────────────────────────────────

  /** GET /api/users/profile */
  static getMyProfileStatisticsController = catchAsync(async (req, res) => {
    const user = await User.findById(req.userId).populate('address');
    if (!user) throw AppError.notFound('User not found');
    return sendSuccess(res, 'Profile retrieved', sanitizeUser(enrichUser(user)));
  });

  /** PUT /api/users/:id/profile */
  static updateProfile = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    await user.updateProfile(req.body);
    return sendSuccess(res, 'Profile updated', sanitizeUser(user));
  });

  /** PUT /api/users/:id/profile/picture */
  static updateProfilePicture = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    const { url, name, size, type } = req.body;
    if (!url) throw AppError.badRequest('Profile picture URL is required');

    user.profilePicture = { url, name, size, type };
    await user.save();

    await userEmails.emailProfilePictureUpdated(user);

    return sendSuccess(res, 'Profile picture updated', { profilePicture: user.profilePicture });
  });

  /** PUT /api/users/:id/profile/email */
  static updateEmail = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    const { email } = req.body;
    if (!email) throw AppError.badRequest('Email is required');

    const taken = await User.findOne({ tenantId, email: email.toLowerCase(), _id: { $ne: id } });
    if (taken) throw AppError.conflict('Email already in use');

    const oldEmail = user.email;
    user.email         = email.toLowerCase();
    user.emailVerified = false;
    user.updated_by    = req.userId;
    await user.save();

    await userEmails.emailEmailChanged(user, oldEmail);

    return sendSuccess(res, 'Email updated. Verification required.', { email: user.email });
  });

  /** PUT /api/users/:id/profile/phone */
  static updatePhoneNumber = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    const { phoneNumber } = req.body;
    if (!phoneNumber) throw AppError.badRequest('Phone number is required');

    user.phoneNumber  = phoneNumber;
    user.phoneVerified = false;
    user.updated_by   = req.userId;
    await user.save();

    await userEmails.emailPhoneChanged(user);

    return sendSuccess(res, 'Phone number updated', { phoneNumber: user.phoneNumber });
  });

  // ── Authentication sub-routes ─────────────────────────────────────────────

  /** PUT /api/users/:id/authentication/verify — admin manually verifies a user */
  static verifyUser = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    await user.verifyUser();
    await userEmails.emailUserVerified(user);
    return sendSuccess(res, 'User verified successfully');
  });

  // ── Role ─────────────────────────────────────────────────────────────────

  /** PATCH /api/users/:userId/role */
  static assignUserRoleById = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { roleId } = req.body;
    if (!roleId) throw AppError.badRequest('roleId is required');
    if (!mongoose.Types.ObjectId.isValid(roleId)) throw AppError.badRequest('roleId must be a valid ObjectId');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: userId, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.role       = roleId;
    user.updated_by = req.userId;
    await user.save();
    await user.populate({ path: 'role', select: 'name' });

    ActivityHelper.logCRUD(req, 'User', 'ROLE_ASSIGN', { id: userId, roleId });

    await userEmails.emailRoleChanged(user, user.role?.name);

    return sendSuccess(res, 'Role assigned to user', { id: user._id, role: { _id: user.role._id, name: user.role?.name } });
  });

  // ── Favorites ─────────────────────────────────────────────────────────────

  /** POST /api/users/:id/favorites */
  static addFavoriteProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { productId } = req.body;
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) throw AppError.badRequest('Valid productId is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    await user.addFavoriteProduct(productId);
    return sendSuccess(res, 'Added to favorites', { count: user.favoriteProducts.length });
  });

  /** DELETE /api/users/:id/favorites */
  static removeFavoriteProduct = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { productId } = req.body;
    if (!productId || !mongoose.Types.ObjectId.isValid(productId)) throw AppError.badRequest('Valid productId is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    await user.removeFavoriteProduct(productId);
    return sendSuccess(res, 'Removed from favorites', { count: user.favoriteProducts.length });
  });

  // ── Preferences ───────────────────────────────────────────────────────────

  /** PUT /api/users/:id/preferences */
  static updatePreferences = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    await user.updatePreferences(req.body);
    return sendSuccess(res, 'Preferences updated', { preferences: user.preferences });
  });

  // ── Loyalty ───────────────────────────────────────────────────────────────

  /** POST /api/users/:id/loyalty/add */
  static addLoyaltyPoints = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { points } = req.body;
    if (!points || isNaN(points) || points <= 0) throw AppError.badRequest('Valid points value is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    const addedPts = parseInt(points, 10);
    await user.addLoyaltyPoints(addedPts);
    await userEmails.emailLoyaltyCredit(user, addedPts);
    return sendSuccess(res, 'Loyalty points added', { loyaltyPoints: user.loyaltyPoints });
  });

  /** POST /api/users/:id/loyalty/redeem */
  static redeemLoyaltyPoints = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { points } = req.body;
    if (!points || isNaN(points) || points <= 0) throw AppError.badRequest('Valid points value is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    const redeemedPts = parseInt(points, 10);
    await user.redeemLoyaltyPoints(redeemedPts);
    await userEmails.emailLoyaltyRedeem(user, redeemedPts);
    return sendSuccess(res, 'Loyalty points redeemed', { loyaltyPoints: user.loyaltyPoints });
  });

  // ── Addresses ─────────────────────────────────────────────────────────────

  /** POST /api/users/:id/addresses */
  static addAddress = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    const address = await Address.create({
      ...req.body,
      user:      id,
      tenantId,
      created_by: req.userId,
    });

    user.address.push(address._id);
    await user.save();

    return sendCreated(res, 'Address added', address);
  });

  /** PUT /api/users/:id/addresses/:addressId */
  static updateAddress = catchAsync(async (req, res) => {
    const { id, addressId } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;

    const address = await Address.findOne({ _id: addressId, user: id, tenantId });
    if (!address) throw AppError.notFound('Address not found');

    // Block re-assigning the address to a different user
    delete req.body.user;
    delete req.body.tenantId;

    Object.assign(address, req.body);
    address.updated_by = req.userId;
    await address.save();

    return sendSuccess(res, 'Address updated', address);
  });

  /** DELETE /api/users/:id/addresses/:addressId */
  static removeAddress = catchAsync(async (req, res) => {
    const { id, addressId } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;

    const address = await Address.findOneAndDelete({ _id: addressId, user: id, tenantId });
    if (!address) throw AppError.notFound('Address not found');

    await User.updateOne({ _id: id }, { $pull: { address: addressId } });

    return sendNoContent(res);
  });

  /** PATCH /api/users/:id/addresses/:addressId/default */
  static setDefaultAddress = catchAsync(async (req, res) => {
    const { id, addressId } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;

    // Unset all defaults for this user
    await Address.updateMany({ user: id, tenantId }, { $set: { isDefault: false } });

    const address = await Address.findOneAndUpdate(
      { _id: addressId, user: id, tenantId },
      { $set: { isDefault: true } },
      { new: true }
    );
    if (!address) throw AppError.notFound('Address not found');

    return sendSuccess(res, 'Default address set', address);
  });

  // ── Search & Lookup ───────────────────────────────────────────────────────

  /** GET /api/users/search?q=keyword */
  static searchUsers = catchAsync(async (req, res) => {
    const { q } = req.query;
    if (!q || q.trim().length < 2) throw AppError.badRequest('Search query must be at least 2 characters');

    const tenantId = req.tenantId || req.user?.tenantId;
    const regex    = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const users = await User.find({
      tenantId,
      isDeleted: false,
      $or: [{ email: regex },{ username: regex },{ firstName: regex },{ lastName: regex }],
    }).limit(20).select('firstName lastName email username profilePicture role status');

    return sendSuccess(res, 'Search results', users);
  });

  /** GET /api/users/by-email/:email */
  static findByEmail = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findByEmail(tenantId, req.params.email);
    if (!user) throw AppError.notFound('User not found');
    return sendSuccess(res, 'User found', sanitizeUser(user));
  });

  /** GET /api/users/by-username/:username */
  static findByUsername = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findByUsername(tenantId, req.params.username);
    if (!user) throw AppError.notFound('User not found');
    return sendSuccess(res, 'User found', sanitizeUser(user));
  });

  /** GET /api/users/list/admins */
  static getAdmins = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const admins = await User.getAdmins(tenantId);
    return sendSuccess(res, 'Admins retrieved', admins.map(sanitizeUser));
  });

  /** GET /api/users/list/customers */
  static getCustomers = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const customers = await User.getCustomers(tenantId);
    return sendSuccess(res, 'Customers retrieved', customers.map(sanitizeUser));
  });

  // ── Security & Sessions ───────────────────────────────────────────────────

  /** GET /api/users/:id/security */
  static getSecurityInfo = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false })
      .select('loginSecurity twoFactorAuth emailVerified phoneVerified isVerified lastLogin loginCount');
    if (!user) throw AppError.notFound('User not found');

    const info = {
      loginSecurity: user.loginSecurity,
      hasTOTP:       user.hasActiveTOTP,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      isVerified:    user.isVerified,
      lastLogin:     user.lastLogin,
      loginCount:    user.loginCount,
      securityScore: UserController.calculateSecurityScore(user),
    };

    return sendSuccess(res, 'Security info retrieved', info);
  });

  /** GET /api/users/:id/sessions */
  static getActiveSessions = catchAsync(async (req, res) => {
    const { id } = req.params;
    const page  = parseInt(req.query.page  || '1',  10);
    const limit = parseInt(req.query.limit || '20', 10);

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).select('activeSessions');
    if (!user) throw AppError.notFound('User not found');

    const total    = user.activeSessions.filter((s) => s.isActive).length;
    const sessions = user.activeSessions
      .filter((s) => s.isActive)
      .slice((page - 1) * limit, page * limit);

    return sendPaginated(res, 'Active sessions', sessions, total, page, limit);
  });

  /** GET /api/users/:id/devices/trusted */
  static getTrustedDevices = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).select('knownDevices');
    if (!user) throw AppError.notFound('User not found');

    const trusted = user.knownDevices.filter((d) => d.isTrusted && d.isActive);
    return sendSuccess(res, 'Trusted devices', trusted);
  });

  /** GET /api/users/:id/devices/known */
  static getKnownDevices = catchAsync(async (req, res) => {
    const { id } = req.params;
    const page  = parseInt(req.query.page  || '1',  10);
    const limit = parseInt(req.query.limit || '20', 10);

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).select('knownDevices');
    if (!user) throw AppError.notFound('User not found');

    const total   = user.knownDevices.length;
    const devices = user.knownDevices.slice((page - 1) * limit, page * limit);

    return sendPaginated(res, 'Known devices', devices, total, page, limit);
  });

  /** GET /api/users/:id/login-history */
  static getLoginHistory = catchAsync(async (req, res) => {
    const { id } = req.params;
    const page  = parseInt(req.query.page  || '1',  10);
    const limit = parseInt(req.query.limit || '20', 10);

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).select('loginHistory');
    if (!user) throw AppError.notFound('User not found');

    const total   = user.loginHistory.length;
    const history = [...user.loginHistory]
      .sort((a, b) => new Date(b.loginTime) - new Date(a.loginTime))
      .slice((page - 1) * limit, page * limit);

    return sendPaginated(res, 'Login history', history, total, page, limit);
  });

  /** GET /api/users/:id/security/logs */
  static getSecurityLogs = catchAsync(async (req, res) => {
    const { id } = req.params;
    const page  = parseInt(req.query.page  || '1',  10);
    const limit = parseInt(req.query.limit || '20', 10);

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).select('securityEvents');
    if (!user) throw AppError.notFound('User not found');

    const total  = user.securityEvents.length;
    const events = [...user.securityEvents]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice((page - 1) * limit, page * limit);

    return sendPaginated(res, 'Security logs', events, total, page, limit);
  });

  // ── Social ────────────────────────────────────────────────────────────────

  /** GET /api/users/:id/social */
  static getSocialAccounts = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).select('socialAccounts socialMedia');
    if (!user) throw AppError.notFound('User not found');

    return sendSuccess(res, 'Social accounts', {
      socialAccounts: user.socialAccounts,
      socialMedia:    user.socialMedia,
    });
  });

  // ── Bulk Operations ───────────────────────────────────────────────────────

  /** DELETE /api/users/bulk */
  static bulkDeleteUsers = catchAsync(async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw AppError.badRequest('ids array is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const result = await User.updateMany(
      { _id: { $in: ids }, tenantId },
      { $set: { isDeleted: true, status: 'deleted', deleted_by: req.userId, deletedAt: new Date() } }
    );

    ActivityHelper.logCRUD(req, 'User', 'BULK_DELETE', { count: result.modifiedCount });
    return sendSuccess(res, `${result.modifiedCount} users deleted`);
  });

  /** PUT /api/users/bulk */
  static bulkUpdateUsers = catchAsync(async (req, res) => {
    const { ids, data } = req.body;
    if (!Array.isArray(ids) || !data) throw AppError.badRequest('ids and data are required');

    // Block elevation of privileges via bulk update
    const safeData = { ...data };
    delete safeData.hash_password;
    delete safeData.refreshTokens;
    delete safeData.tenantId;

    const tenantId = req.tenantId || req.user?.tenantId;
    const result = await User.updateMany(
      { _id: { $in: ids }, tenantId },
      { $set: { ...safeData, updated_by: req.userId } }
    );

    ActivityHelper.logCRUD(req, 'User', 'BULK_UPDATE', { count: result.modifiedCount });
    return sendSuccess(res, `${result.modifiedCount} users updated`);
  });

  /** PATCH /api/users/bulk/status */
  static bulkUpdateStatus = catchAsync(async (req, res) => {
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || !status) throw AppError.badRequest('ids and status are required');

    const validStatuses = ['active','inactive','pending','banned'];
    if (!validStatuses.includes(status)) throw AppError.badRequest(`Status must be one of: ${validStatuses.join(', ')}`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const result = await User.updateMany(
      { _id: { $in: ids }, tenantId },
      { $set: { status, updated_by: req.userId } }
    );

    return sendSuccess(res, `${result.modifiedCount} users updated to status '${status}'`);
  });

  // ── Stats & Analytics ─────────────────────────────────────────────────────

  /** GET /api/users/stats-data */
  static getUserStats = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.headers['x-tenant-id'];
    const scope    = tenantId ? { tenantId } : {};

    const [total, active, inactive, banned, admins, customers] = await Promise.all([
      User.countDocuments({ ...scope, isDeleted: false }),
      User.countDocuments({ ...scope, status: 'active', isDeleted: false }),
      User.countDocuments({ ...scope, status: 'inactive', isDeleted: false }),
      User.countDocuments({ ...scope, status: 'banned', isDeleted: false }),
      User.countDocuments({ ...scope, role: { $in: ['admin','super_admin'] }, isDeleted: false }),
      User.countDocuments({ ...scope, role: 'customer', isDeleted: false }),
    ]);

    return sendSuccess(res, 'User stats', { total, active, inactive, banned, admins, customers });
  });

  /** GET /api/users/analytics */
  static getDashboardStats = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.headers['x-tenant-id'];
    const scope    = tenantId ? { tenantId } : {};
    const now      = new Date();
    const thirtyDaysAgo = new Date(now - 30 * 86400000);
    const sevenDaysAgo  = new Date(now - 7 * 86400000);

    const [
      totalUsers,
      newLast30Days,
      newLast7Days,
      activeUsers,
      verifiedUsers,
      mfaEnabled,
    ] = await Promise.all([
      User.countDocuments({ ...scope, isDeleted: false }),
      User.countDocuments({ ...scope, createdAt: { $gte: thirtyDaysAgo }, isDeleted: false }),
      User.countDocuments({ ...scope, createdAt: { $gte: sevenDaysAgo },  isDeleted: false }),
      User.countDocuments({ ...scope, status: 'active', isDeleted: false }),
      User.countDocuments({ ...scope, isVerified: true, isDeleted: false }),
      User.countDocuments({ ...scope, 'twoFactorAuth.enabled': true, isDeleted: false }),
    ]);

    return sendSuccess(res, 'Dashboard analytics', {
      totalUsers,
      newLast30Days,
      newLast7Days,
      activeUsers,
      verifiedUsers,
      mfaEnabled,
      activeRate: totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0,
      mfaRate:    totalUsers > 0 ? Math.round((mfaEnabled  / totalUsers) * 100) : 0,
    });
  });

  // ── Calculated helpers ────────────────────────────────────────────────────

  static calculateUserScore(user) {
    let score = 0;
    if ((user.orders?.length || 0) > 0)          score += 20;
    if ((user.loyaltyPoints || 0) > 100)          score += 20;
    if (user.subscriptionStatus === 'active')     score += 20;
    if (user.twoFactorAuth?.enabled)              score += 20;
    if (user.emailVerified)                       score += 10;
    if (user.profilePicture?.url)                 score += 10;
    return score;
  }

  static getUserActivityLevel(user) {
    const days = user.lastLogin
      ? Math.floor((Date.now() - new Date(user.lastLogin)) / 86400000)
      : Infinity;
    if (days <= 7)   return 'Very Active';
    if (days <= 30)  return 'Active';
    if (days <= 90)  return 'Moderately Active';
    return 'Inactive';
  }

  static calculateProfileCompleteness(user) {
    const fields = ['firstName','lastName','phoneNumber','profilePicture','dateOfBirth','gender'];
    const filled = fields.filter((f) => {
      const v = user[f];
      return v !== null && v !== undefined && v !== '' && !(typeof v === 'object' && !v.url);
    });
    return Math.round((filled.length / fields.length) * 100);
  }

  static calculateSecurityScore(user) {
    let score = 0;
    if (user.emailVerified)           score += 25;
    if (user.twoFactorAuth?.enabled)  score += 40;
    if ((user.knownDevices?.length || 0) > 0) score += 20;
    if (user.phoneVerified)           score += 15;
    return score;
  }

  // ── Preferences sub-routes ────────────────────────────────────────────────

  /** PUT /api/users/:id/preferences/newsletter */
  static toggleNewsletterSubscription = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    user.preferences.newsletter = !user.preferences.newsletter;
    await user.save();
    await userEmails.emailNewsletterPreference(user, user.preferences.newsletter);
    return sendSuccess(res, 'Newsletter subscription toggled', { newsletter: user.preferences.newsletter });
  });

  /** PUT /api/users/:id/preferences/notifications */
  static toggleNotifications = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    user.preferences.notifications = !user.preferences.notifications;
    await user.save();
    return sendSuccess(res, 'Notifications toggled', { notifications: user.preferences.notifications });
  });

  /** PUT /api/users/:id/preferences/theme */
  static setThemePreference = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { theme } = req.body;
    if (!theme || !['light', 'dark', 'system'].includes(theme)) throw AppError.badRequest('Valid theme (light/dark/system) is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    user.preferences.theme = theme;
    await user.save();
    return sendSuccess(res, 'Theme preference updated', { theme: user.preferences.theme });
  });

  /** PUT /api/users/:id/preferences/language */
  static updateLanguagePreference = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { languageCode } = req.body;
    if (!languageCode) throw AppError.badRequest('Language code is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    user.preferences.language = languageCode;
    await user.save();
    return sendSuccess(res, 'Language preference updated', { language: user.preferences.language });
  });

  // ── Loyalty extras ────────────────────────────────────────────────────────

  /** POST /api/users/:id/loyalty/transfer */
  static transferLoyaltyPoints = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { toUserId, points } = req.body;
    if (!toUserId || !mongoose.Types.ObjectId.isValid(toUserId)) throw AppError.badRequest('Valid recipientUserId is required');
    const pts = parseInt(points, 10);
    if (!pts || pts <= 0) throw AppError.badRequest('Points must be a positive integer');

    const tenantId = req.tenantId || req.user?.tenantId;
    const [fromUser, toUser] = await Promise.all([
      User.findOne({ _id: id, tenantId, isDeleted: false }),
      User.findOne({ _id: toUserId, tenantId, isDeleted: false }),
    ]);
    if (!fromUser) throw AppError.notFound('Source user not found');
    if (!toUser)   throw AppError.notFound('Recipient user not found');
    if ((fromUser.loyaltyPoints || 0) < pts) throw AppError.badRequest('Insufficient loyalty points');

    fromUser.loyaltyPoints = (fromUser.loyaltyPoints || 0) - pts;
    toUser.loyaltyPoints   = (toUser.loyaltyPoints   || 0) + pts;
    await Promise.all([fromUser.save(), toUser.save()]);

    await Promise.all([
      userEmails.emailLoyaltyTransferOut(fromUser, toUser, pts),
      userEmails.emailLoyaltyTransferIn(toUser, fromUser, pts),
    ]);

    return sendSuccess(res, 'Loyalty points transferred', { transferred: pts, remaining: fromUser.loyaltyPoints });
  });

  /** PUT /api/users/:id/loyalty/reset */
  static resetLoyaltyPoints = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.loyaltyPoints = 0;
    await user.save();
    await userEmails.emailLoyaltyReset(user);
    return sendSuccess(res, 'Loyalty points reset', { loyaltyPoints: 0 });
  });

  // ── Subscription ──────────────────────────────────────────────────────────

  /** PUT /api/users/:id/subscription */
  static updateSubscription = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { type } = req.body;
    const validTypes = ['free', 'basic', 'premium', 'enterprise'];
    if (!type || !validTypes.includes(type)) throw AppError.badRequest(`Valid subscription type required: ${validTypes.join(', ')}`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.subscriptionType   = type;
    user.subscriptionStatus = 'active';
    await user.save();
    await userEmails.emailSubscriptionUpdated(user);
    return sendSuccess(res, 'Subscription updated', { subscriptionType: user.subscriptionType, subscriptionStatus: user.subscriptionStatus });
  });

  /** DELETE /api/users/:id/subscription */
  static cancelSubscription = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.subscriptionStatus = 'cancelled';
    await user.save();
    await userEmails.emailSubscriptionCancelled(user);
    return sendSuccess(res, 'Subscription cancelled', { subscriptionStatus: user.subscriptionStatus });
  });

  // ── Account Status ────────────────────────────────────────────────────────

  /** PUT /api/users/:id/status */
  static updateStatus = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['active', 'inactive', 'pending', 'banned', 'deleted', 'archived', 'draft', 'suspended'];
    if (!status || !validStatuses.includes(status)) throw AppError.badRequest(`Valid status required: ${validStatuses.join(', ')}`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.status     = status;
    user.isActive   = status === 'active';
    user.updated_by = req.userId;
    await user.save();
    return sendSuccess(res, 'User status updated', { status: user.status });
  });

  /** PUT /api/users/:id/deactivate-account */
  static deactivateAccount = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.status     = 'inactive';
    user.isActive   = false;
    user.updated_by = req.userId;
    if (reason) user.meta = { ...user.meta, deactivationReason: reason };
    await user.save();
    await user.logSecurityEvent('account_deactivated', reason || 'Account deactivated', 'medium');
    await userEmails.emailAccountDeactivated(user, reason);
    return sendSuccess(res, 'Account deactivated');
  });

  /** PUT /api/users/:id/reactivate-account */
  static reactivateAccount = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.status     = 'active';
    user.isActive   = true;
    user.updated_by = req.userId;
    await user.save();
    await user.logSecurityEvent('account_reactivated', 'Account reactivated', 'low');
    await userEmails.emailAccountReactivated(user);
    return sendSuccess(res, 'Account reactivated');
  });

  /** PATCH /api/users/:userId/activate */
  static activateUser = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { reason } = req.body;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: userId, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.status     = 'active';
    user.isActive   = true;
    user.updated_by = req.userId;
    await user.save();
    await user.logSecurityEvent('admin_activated', reason || 'Admin activated account', 'low');
    await userEmails.emailAccountReactivated(user);
    return sendSuccess(res, 'User activated successfully', sanitizeUser(user));
  });

  /** PATCH /api/users/:userId/deactivate */
  static deactivateUser = catchAsync(async (req, res) => {
    const { userId } = req.params;
    const { reason } = req.body;
    const tenantId = req.tenantId || req.user?.tenantId;

    if (String(userId) === String(req.userId)) throw AppError.badRequest('Cannot deactivate your own account');

    const user = await User.findOne({ _id: userId, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.status     = 'inactive';
    user.isActive   = false;
    user.updated_by = req.userId;
    await user.save();
    await user.logSecurityEvent('admin_deactivated', reason || 'Admin deactivated account', 'medium');
    await userEmails.emailAccountDeactivated(user, reason);
    return sendSuccess(res, 'User deactivated successfully', sanitizeUser(user));
  });

  /** PUT /api/users/:id/lock */
  static lockAccount = catchAsync(async (req, res) => {
    const { id } = req.params;
    const durationMs = parseInt(req.body.durationMs, 10) || 3_600_000; // default 1 hour

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.loginSecurity.lockedUntil     = new Date(Date.now() + durationMs);
    user.loginSecurity.failedAttempts  = (user.loginSecurity.failedAttempts || 0);
    user.updated_by = req.userId;
    await user.save();
    await user.logSecurityEvent('account_locked', 'Admin locked account', 'high');
    await userEmails.emailAccountLocked(user, user.loginSecurity.lockedUntil);
    return sendSuccess(res, 'Account locked', { lockedUntil: user.loginSecurity.lockedUntil });
  });

  /** PUT /api/users/:id/unlock */
  static unlockAccount = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.loginSecurity.lockedUntil         = null;
    user.loginSecurity.failedAttempts      = 0;
    user.loginSecurity.consecutiveFailures = 0;
    user.updated_by = req.userId;
    await user.save();
    await user.logSecurityEvent('account_unlocked', 'Admin unlocked account', 'low');
    await userEmails.emailAccountUnlocked(user);
    return sendSuccess(res, 'Account unlocked');
  });

  // ── Interests ─────────────────────────────────────────────────────────────

  /** POST /api/users/:id/interests */
  static addInterest = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { interest } = req.body;
    if (!interest || !interest.trim()) throw AppError.badRequest('Interest is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    const val = interest.trim().toLowerCase();
    if (!user.interests.includes(val)) {
      user.interests.push(val);
      await user.save();
    }
    return sendSuccess(res, 'Interest added', { interests: user.interests });
  });

  /** DELETE /api/users/:id/interests */
  static removeInterest = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { interest } = req.body;
    if (!interest) throw AppError.badRequest('Interest is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.interests = user.interests.filter((i) => i !== interest.trim().toLowerCase());
    await user.save();
    return sendSuccess(res, 'Interest removed', { interests: user.interests });
  });

  /** POST /api/users/:id/interests/category */
  static addInterestCategory = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { category } = req.body;
    if (!category || !category.trim()) throw AppError.badRequest('Category is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    const tag = `category:${category.trim().toLowerCase()}`;
    if (!user.interests.includes(tag)) {
      user.interests.push(tag);
      await user.save();
    }
    return sendSuccess(res, 'Interest category added', { interests: user.interests });
  });

  /** DELETE /api/users/:id/interests/clear */
  static clearInterests = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.interests = [];
    await user.save();
    return sendSuccess(res, 'Interests cleared', { interests: [] });
  });

  // ── Session & Security extras ─────────────────────────────────────────────

  /** POST /api/users/:id/sessions/invalidate-all */
  static invalidateAllSessions = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.activeSessions  = user.activeSessions.map((s) => ({ ...s.toObject?.() ?? s, isActive: false }));
    user.refreshTokens   = user.refreshTokens.map((t) => ({ ...t.toObject?.() ?? t, isActive: false }));
    await user.save();
    await user.logSecurityEvent('all_sessions_invalidated', 'All sessions invalidated', 'high');
    await userEmails.emailSessionsInvalidated(user);
    return sendSuccess(res, 'All sessions invalidated');
  });

  /** POST /api/users/:id/sessions/revoke-token */
  static revokeToken = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { token } = req.body;
    if (!token) throw AppError.badRequest('Token is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    const idx = user.refreshTokens.findIndex((t) => t.token === token);
    if (idx !== -1) {
      user.refreshTokens[idx].isActive = false;
      await user.save();
    }
    await user.logSecurityEvent('token_revoked', 'Refresh token revoked', 'medium');
    return sendSuccess(res, 'Token revoked');
  });

  /** PUT /api/users/:id/login-timestamp */
  static updateLoginTimestamp = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.lastLogin  = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    await user.save();
    return sendSuccess(res, 'Login timestamp updated', { lastLogin: user.lastLogin, loginCount: user.loginCount });
  });

  /** PUT /api/users/:id/failed-logins/increment */
  static incrementFailedLogins = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    await user.incrementFailedLogin();
    return sendSuccess(res, 'Failed login count incremented', { failedAttempts: user.loginSecurity.failedAttempts });
  });

  /** PUT /api/users/:id/failed-logins/reset */
  static resetFailedLogins = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    await user.resetFailedLogin();
    return sendSuccess(res, 'Failed login count reset');
  });

  // ── Reporting ─────────────────────────────────────────────────────────────

  /** GET /api/users/:id/statistics */
  static getUserStatistics = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).populate('role', 'name');
    if (!user) throw AppError.notFound('User not found');

    const stats = {
      id:                   user._id,
      username:             user.username,
      email:                user.email,
      status:               user.status,
      isVerified:           user.isVerified,
      loyaltyPoints:        user.loyaltyPoints,
      subscriptionType:     user.subscriptionType,
      subscriptionStatus:   user.subscriptionStatus,
      loginCount:           user.loginCount,
      lastLogin:            user.lastLogin,
      addressCount:         (user.address || []).length,
      favoriteProductCount: (user.favoriteProducts || []).length,
      interestCount:        (user.interests || []).length,
      activeSessionCount:   (user.activeSessions || []).filter((s) => s.isActive).length,
      knownDeviceCount:     (user.knownDevices  || []).length,
      failedAttempts:       user.loginSecurity?.failedAttempts || 0,
      profileCompleteness:  UserController.calculateProfileCompleteness(user),
      securityScore:        UserController.calculateSecurityScore(user),
      userScore:            UserController.calculateUserScore(user),
      activityLevel:        UserController.getUserActivityLevel(user),
      registeredAt:         user.createdAt,
    };
    return sendSuccess(res, 'User statistics retrieved', stats);
  });

  /** GET /api/users/:id/report */
  static getUserReport = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).populate('role', 'name').populate('address');
    if (!user) throw AppError.notFound('User not found');

    const report = {
      user:     sanitizeUser(user),
      security: {
        securityScore:    UserController.calculateSecurityScore(user),
        isLocked:         user.isLocked,
        hasTOTP:          user.hasActiveTOTP,
        emailVerified:    user.emailVerified,
        phoneVerified:    user.phoneVerified,
        failedAttempts:   user.loginSecurity?.failedAttempts || 0,
        recentEvents:     (user.securityEvents || []).slice(-10),
      },
      activity: {
        loginCount:       user.loginCount,
        lastLogin:        user.lastLogin,
        activityLevel:    UserController.getUserActivityLevel(user),
        sessionCount:     (user.activeSessions || []).filter((s) => s.isActive).length,
      },
      preferences:    user.preferences,
      interests:      user.interests,
      loyaltyPoints:  user.loyaltyPoints,
      generatedAt:    new Date(),
    };
    return sendSuccess(res, 'User report retrieved', report);
  });

  /** GET /api/users/:id/activity-summary */
  static getActivitySummary = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false })
      .select('lastLogin loginCount loginHistory activeSessions securityEvents loyaltyPoints interests');
    if (!user) throw AppError.notFound('User not found');

    const recentLogins = (user.loginHistory || [])
      .sort((a, b) => new Date(b.loginTime) - new Date(a.loginTime))
      .slice(0, 5);

    const summary = {
      lastLogin:           user.lastLogin,
      loginCount:          user.loginCount,
      recentLogins,
      activeSessionCount:  (user.activeSessions || []).filter((s) => s.isActive).length,
      recentSecurityEvents:(user.securityEvents  || []).slice(-5),
      loyaltyPoints:       user.loyaltyPoints,
      interestCount:       (user.interests || []).length,
      activityLevel:       UserController.getUserActivityLevel(user),
    };
    return sendSuccess(res, 'Activity summary retrieved', summary);
  });

  /** PUT /api/users/:id/dynamic-update */
  static dynamicUpdate = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { field, value } = req.body;
    if (!field || value === undefined) throw AppError.badRequest('field and value are required');

    // Block sensitive / structural fields from dynamic update
    const blockedFields = ['hash_password', 'password', 'tenantId', '_id', 'role', 'permissions', 'refreshTokens', 'isDeleted'];
    if (blockedFields.includes(field)) throw AppError.forbidden(`Field '${field}' cannot be updated via this endpoint`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user[field]     = value;
    user.updated_by = req.userId;
    await user.save();
    return sendSuccess(res, `${field} updated successfully`, { [field]: user[field] });
  });

  // ── Social Media ──────────────────────────────────────────────────────────

  /** PUT /api/users/:id/social-media */
  static updateSocialMedia = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');
    if (!isOwnerOrAdmin(req, id)) throw AppError.forbidden('Access denied');

    const allowed = ['facebook', 'twitter', 'instagram', 'linkedin', 'google', 'pinterest'];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) user.socialMedia[key] = req.body[key];
    });
    await user.save();
    return sendSuccess(res, 'Social media updated', { socialMedia: user.socialMedia });
  });

  /** POST /api/users/:id/social-media/link */
  static linkSocialAccount = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { platform, socialId, email, displayName } = req.body;
    if (!platform || !socialId) throw AppError.badRequest('platform and socialId are required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    const existingIdx = user.socialAccounts.findIndex((a) => a.provider === platform);
    if (existingIdx !== -1) {
      user.socialAccounts[existingIdx].providerId = socialId;
      if (email)       user.socialAccounts[existingIdx].email       = email;
      if (displayName) user.socialAccounts[existingIdx].displayName = displayName;
    } else {
      user.socialAccounts.push({ provider: platform, providerId: socialId, email, displayName, connectedAt: new Date() });
    }
    await user.save();
    await userEmails.emailSocialLinked(user, platform);
    return sendSuccess(res, 'Social account linked', { socialAccounts: user.socialAccounts });
  });

  /** DELETE /api/users/:id/social-media/unlink */
  static unlinkSocialAccount = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { platform } = req.body;
    if (!platform) throw AppError.badRequest('platform is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.socialAccounts = user.socialAccounts.filter((a) => a.provider !== platform);
    await user.save();
    await userEmails.emailSocialUnlinked(user, platform);
    return sendSuccess(res, 'Social account unlinked', { socialAccounts: user.socialAccounts });
  });

  /** DELETE /api/users/:id/social-media/clear */
  static clearAllSocialLinks = catchAsync(async (req, res) => {
    const { id } = req.params;
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false });
    if (!user) throw AppError.notFound('User not found');

    user.socialAccounts = [];
    user.socialMedia    = { facebook: null, twitter: null, instagram: null, linkedin: null, google: null, pinterest: null };
    await user.save();
    return sendSuccess(res, 'All social links cleared');
  });

  // ── Notification ──────────────────────────────────────────────────────────

  /** POST /api/users/:id/notify */
  static sendNotification = catchAsync(async (req, res) => {
    const { id } = req.params;
    const { title, message, type = 'info' } = req.body;
    if (!title || !message) throw AppError.badRequest('title and message are required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: id, tenantId, isDeleted: false }).select('email firstName username preferences');
    if (!user) throw AppError.notFound('User not found');

    if (user.preferences?.notifications) {
      await userEmails.emailNotification(user, title, message, type);
    }

    return sendSuccess(res, 'Notification sent', { sent: true, userId: id, title, message, type });
  });

  // ── Search extras ─────────────────────────────────────────────────────────

  /** GET /api/users/search/email-username?term= */
  static searchByEmailOrUsername = catchAsync(async (req, res) => {
    const { term } = req.query;
    if (!term || term.trim().length < 2) throw AppError.badRequest('Search term must be at least 2 characters');

    const tenantId = req.tenantId || req.user?.tenantId;
    const regex    = new RegExp(term.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users    = await User.find({
      tenantId,
      isDeleted: false,
      $or: [{ email: regex }, { username: regex }],
    }).limit(20).select('firstName lastName email username profilePicture status role');

    return sendSuccess(res, 'Search completed', users.map(sanitizeUser));
  });

  /** GET /api/users/search/dynamic?field=email&value=foo */
  static dynamicSearch = catchAsync(async (req, res) => {
    const { field, value } = req.query;
    if (!field || !value) throw AppError.badRequest('field and value are required');

    const blockedFields = ['hash_password', 'refreshTokens', 'twoFactorAuth.secret'];
    if (blockedFields.includes(field)) throw AppError.forbidden(`Field '${field}' is not searchable`);

    const tenantId = req.tenantId || req.user?.tenantId;
    const users    = await User.find({
      tenantId,
      isDeleted: false,
      [field]: typeof value === 'string' && value.startsWith('/') ? new RegExp(value.slice(1, -1), 'i') : value,
    }).limit(50);

    return sendSuccess(res, 'Dynamic search completed', users.map(sanitizeUser));
  });

  /** GET /api/users/advanced-search */
  static advancedSearch = catchAsync(async (req, res) => {
    const { query, filters, sort = 'createdAt', order = 'desc', page = 1, limit = 20 } = req.query;

    const parsedFilters = filters ? (typeof filters === 'string' ? JSON.parse(filters) : filters) : {};
    const tenantId      = req.tenantId || req.user?.tenantId;

    const searchQuery = { tenantId, isDeleted: false, ...parsedFilters };
    if (query) {
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      searchQuery.$or = [{ firstName: regex }, { lastName: regex }, { email: regex }, { username: regex }];
    }

    const skip    = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const sortObj = { [sort]: order === 'asc' ? 1 : -1 };

    const [users, total] = await Promise.all([
      User.find(searchQuery).populate('role', 'name').sort(sortObj).skip(skip).limit(parseInt(limit, 10)),
      User.countDocuments(searchQuery),
    ]);

    return sendPaginated(
      res, 'Advanced search completed',
      users.map(sanitizeUser),
      total, parseInt(page, 10), parseInt(limit, 10),
      { totalPages: Math.ceil(total / limit) }
    );
  });

  // ── Filter routes ─────────────────────────────────────────────────────────

  /** GET /api/users/filter/status?status=active */
  static getUsersByStatus = catchAsync(async (req, res) => {
    const { status } = req.query;
    if (!status) throw AppError.badRequest('status query param is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const users = await User.find({ tenantId, status, isDeleted: false }).populate('role', 'name');
    return sendSuccess(res, `Users with status '${status}'`, users.map(sanitizeUser));
  });

  /** GET /api/users/filter/active */
  static getActiveUsers = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const users = await User.find({ tenantId, status: 'active', isDeleted: false }).populate('role', 'name');
    return sendSuccess(res, 'Active users', users.map(sanitizeUser));
  });

  /** GET /api/users/filter/verified */
  static getVerifiedUsers = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const users = await User.find({ tenantId, isVerified: true, isDeleted: false }).populate('role', 'name');
    return sendSuccess(res, 'Verified users', users.map(sanitizeUser));
  });

  /** GET /api/users/filter/role?role=<ObjectId|name> */
  static getUsersByRole = catchAsync(async (req, res) => {
    const { role } = req.query;
    if (!role) throw AppError.badRequest('role query param is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    let roleFilter;
    if (mongoose.Types.ObjectId.isValid(role)) {
      roleFilter = role;
    } else {
      const { getRoleModel } = require('../models/roleRef');
      const Role = getRoleModel();
      const roleDoc = await Role.findOne({ tenantId, name: role });
      if (!roleDoc) return sendSuccess(res, 'No users found for role', []);
      roleFilter = roleDoc._id;
    }

    const users = await User.find({ tenantId, role: roleFilter, isDeleted: false }).populate('role', 'name');
    return sendSuccess(res, 'Users by role', users.map(sanitizeUser));
  });

  /** GET /api/users/filter/subscription?subscriptionType=premium */
  static getUsersBySubscriptionType = catchAsync(async (req, res) => {
    const { subscriptionType } = req.query;
    if (!subscriptionType) throw AppError.badRequest('subscriptionType query param is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const users = await User.find({ tenantId, subscriptionType, isDeleted: false }).populate('role', 'name');
    return sendSuccess(res, `Users with subscription '${subscriptionType}'`, users.map(sanitizeUser));
  });

  /** GET /api/users/filter/active-within-days?days=30 */
  static findActiveWithinDays = catchAsync(async (req, res) => {
    const days     = parseInt(req.query.days, 10) || 30;
    const since    = new Date(Date.now() - days * 86_400_000);
    const tenantId = req.tenantId || req.user?.tenantId;

    const users = await User.find({ tenantId, isDeleted: false, lastLogin: { $gte: since } }).populate('role', 'name');
    return sendSuccess(res, `Users active within last ${days} days`, users.map(sanitizeUser));
  });

  /** GET /api/users/filter/top-loyal?limit=10 */
  static getTopLoyalUsers = catchAsync(async (req, res) => {
    const limit    = parseInt(req.query.limit, 10) || 10;
    const tenantId = req.tenantId || req.user?.tenantId;

    const users = await User.find({ tenantId, isDeleted: false }).sort({ loyaltyPoints: -1 }).limit(limit).populate('role', 'name');
    return sendSuccess(res, 'Top loyal users', users.map(sanitizeUser));
  });

  /** GET /api/users/filter/never-logged-in */
  static getNeverLoggedInUsers = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const users = await User.find({ tenantId, isDeleted: false, $or: [{ lastLogin: null }, { lastLogin: { $exists: false } }] }).populate('role', 'name');
    return sendSuccess(res, 'Users who never logged in', users.map(sanitizeUser));
  });

  /** GET /api/users/filter/oldest */
  static findOldestUser = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ tenantId, isDeleted: false }).sort({ createdAt: 1 }).populate('role', 'name');
    if (!user) throw AppError.notFound('No users found');
    return sendSuccess(res, 'Oldest user', sanitizeUser(user));
  });

  /** GET /api/users/filter/failed-logins?threshold=5 */
  static findUsersWithFailedLogins = catchAsync(async (req, res) => {
    const threshold = parseInt(req.query.threshold, 10) || 5;
    const tenantId  = req.tenantId || req.user?.tenantId;

    const users = await User.find({
      tenantId, isDeleted: false,
      'loginSecurity.failedAttempts': { $gte: threshold },
    }).populate('role', 'name');
    return sendSuccess(res, `Users with ≥${threshold} failed logins`, users.map(sanitizeUser));
  });

  /** GET /api/users/filter/incomplete-profiles */
  static findUsersWithIncompleteProfiles = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const users = await User.find({
      tenantId, isDeleted: false,
      $or: [
        { firstName: null }, { firstName: '' },
        { lastName:  null }, { lastName:  '' },
        { phoneNumber: null },
        { 'profilePicture.url': null },
      ],
    }).populate('role', 'name');
    return sendSuccess(res, 'Users with incomplete profiles', users.map(sanitizeUser));
  });

  // ── Bulk extras ───────────────────────────────────────────────────────────

  /** PUT /api/users/bulk/update-role */
  static bulkUpdateRole = catchAsync(async (req, res) => {
    const { ids, roleId } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw AppError.badRequest('ids array is required');
    if (!roleId || !mongoose.Types.ObjectId.isValid(roleId)) throw AppError.badRequest('Valid roleId is required');

    const tenantId = req.tenantId || req.user?.tenantId;
    const result = await User.updateMany(
      { _id: { $in: ids }, tenantId, isDeleted: false },
      { $set: { role: roleId, updated_by: req.userId } }
    );
    return sendSuccess(res, 'Roles updated', { matched: result.matchedCount, modified: result.modifiedCount, roleId });
  });

  /** POST /api/users/bulk/add-loyalty-points */
  static bulkAddLoyaltyPoints = catchAsync(async (req, res) => {
    const { ids, points } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) throw AppError.badRequest('ids array is required');
    const pts = parseInt(points, 10);
    if (!pts || pts <= 0) throw AppError.badRequest('Points must be a positive integer');

    const tenantId = req.tenantId || req.user?.tenantId;
    const result = await User.updateMany(
      { _id: { $in: ids }, tenantId, isDeleted: false },
      { $inc: { loyaltyPoints: pts } }
    );
    return sendSuccess(res, 'Loyalty points added', { matched: result.matchedCount, modified: result.modifiedCount, points: pts });
  });

  // ── Analytics ─────────────────────────────────────────────────────────────

  /** GET /api/users/analytics/count-by-role */
  static getUserCountByRole = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const data = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $lookup: { from: 'roles', localField: '_id', foreignField: '_id', as: 'roleInfo' } },
      { $unwind: { path: '$roleInfo', preserveNullAndEmpty: true } },
      { $project: { role: { $ifNull: ['$roleInfo.name', 'unassigned'] }, count: 1, _id: 0 } },
    ]);
    return sendSuccess(res, 'User count by role', data);
  });

  /** GET /api/users/analytics/count-by-subscription */
  static getUserCountBySubscription = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const data = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$subscriptionType', count: { $sum: 1 } } },
      { $project: { subscriptionType: { $ifNull: ['$_id', 'none'] }, count: 1, _id: 0 } },
    ]);
    return sendSuccess(res, 'User count by subscription', data);
  });

  /** GET /api/users/analytics/count-by-country */
  static getUserCountByCountry = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const data = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$meta.customFields.country', count: { $sum: 1 } } },
      { $project: { country: { $ifNull: ['$_id', 'unknown'] }, count: 1, _id: 0 } },
      { $sort: { count: -1 } },
    ]);
    return sendSuccess(res, 'User count by country', data);
  });

  /** GET /api/users/analytics/average-loyalty-points */
  static getAverageLoyaltyPoints = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const [result] = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: null, average: { $avg: '$loyaltyPoints' }, total: { $sum: '$loyaltyPoints' }, count: { $sum: 1 } } },
    ]);
    return sendSuccess(res, 'Average loyalty points', result || { average: 0, total: 0, count: 0 });
  });

  /** GET /api/users/analytics/average-orders */
  static getAverageOrdersPerUser = catchAsync(async (req, res) => {
    // Orders are managed by the order microservice; return placeholder analytics
    const tenantId = req.tenantId || req.user?.tenantId;
    const [result] = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    return sendSuccess(res, 'Average orders per user', { average: 0, userCount: result?.count || 0, note: 'Order data managed by order service' });
  });

  /** GET /api/users/analytics/loyalty-brackets */
  static getUserLoyaltyBrackets = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const data = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      {
        $bucket: {
          groupBy: '$loyaltyPoints',
          boundaries: [0, 100, 500, 1000, 5000, Infinity],
          default: 'other',
          output: { count: { $sum: 1 } },
        },
      },
      { $project: { bracket: '$_id', count: 1, _id: 0 } },
    ]);
    return sendSuccess(res, 'User loyalty brackets', data);
  });

  /** GET /api/users/analytics/top-interests?limit=10 */
  static getTopUserInterests = catchAsync(async (req, res) => {
    const limit    = parseInt(req.query.limit, 10) || 10;
    const tenantId = req.tenantId || req.user?.tenantId;
    const data = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $unwind: '$interests' },
      { $group: { _id: '$interests', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      { $project: { interest: '$_id', count: 1, _id: 0 } },
    ]);
    return sendSuccess(res, 'Top user interests', data);
  });

  /** GET /api/users/analytics/registrations-over-time?days=30 */
  static getRegistrationsOverTime = catchAsync(async (req, res) => {
    const days     = parseInt(req.query.days, 10) || 30;
    const since    = new Date(Date.now() - days * 86_400_000);
    const tenantId = req.tenantId || req.user?.tenantId;
    const data = await User.aggregate([
      { $match: { tenantId, isDeleted: false, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', count: 1, _id: 0 } },
    ]);
    return sendSuccess(res, 'Registrations over time', data);
  });

  /** GET /api/users/analytics/login-activity-over-time?days=30 */
  static getLoginActivityOverTime = catchAsync(async (req, res) => {
    const days     = parseInt(req.query.days, 10) || 30;
    const since    = new Date(Date.now() - days * 86_400_000);
    const tenantId = req.tenantId || req.user?.tenantId;
    const data = await User.aggregate([
      { $match: { tenantId, isDeleted: false, lastLogin: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$lastLogin' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { date: '$_id', count: 1, _id: 0 } },
    ]);
    return sendSuccess(res, 'Login activity over time', data);
  });

  /** GET /api/users/analytics/table-statistics */
  static getTableStatistics = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const [result] = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      {
        $group: {
          _id: null,
          totalUsers:    { $sum: 1 },
          activeUsers:   { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          verifiedUsers: { $sum: { $cond: ['$isVerified', 1, 0] } },
          bannedUsers:   { $sum: { $cond: [{ $eq: ['$status', 'banned'] }, 1, 0] } },
          avgLoyalty:    { $avg: '$loyaltyPoints' },
          premiumUsers:  { $sum: { $cond: [{ $eq: ['$subscriptionType', 'premium'] }, 1, 0] } },
          mfaEnabledUsers: { $sum: { $cond: ['$twoFactorAuth.enabled', 1, 0] } },
        },
      },
    ]);
    return sendSuccess(res, 'Table statistics', result || { totalUsers: 0 });
  });

  /** GET /api/users/analytics/table-report */
  static getTableReport = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const [stats]  = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      {
        $group: {
          _id: null,
          total:    { $sum: 1 },
          active:   { $sum: { $cond: [{ $eq: ['$status', 'active']}, 1, 0] } },
          verified: { $sum: { $cond: ['$isVerified', 1, 0] } },
        },
      },
    ]);
    const roleCounts  = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    const subCounts   = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$subscriptionType', count: { $sum: 1 } } },
    ]);
    const report = {
      overview:       stats    || { total: 0, active: 0, verified: 0 },
      byRole:         roleCounts,
      bySubscription: subCounts,
      generatedAt:    new Date(),
    };
    return sendSuccess(res, 'Table report', report);
  });

  /** GET /api/users/analytics/user-report/:userId */
  static getUserReportByIdStatic = catchAsync(async (req, res) => {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) throw AppError.badRequest('Invalid user ID format');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: userId, tenantId, isDeleted: false }).populate('role', 'name').populate('address');
    if (!user) throw AppError.notFound('User not found');

    const report = {
      user:       sanitizeUser(user),
      statistics: {
        loginCount:          user.loginCount,
        lastLogin:           user.lastLogin,
        loyaltyPoints:       user.loyaltyPoints,
        profileCompleteness: UserController.calculateProfileCompleteness(user),
        securityScore:       UserController.calculateSecurityScore(user),
        activityLevel:       UserController.getUserActivityLevel(user),
      },
      generatedAt: new Date(),
    };
    return sendSuccess(res, 'User report', report);
  });

  /** GET /api/users/analytics/activity-summary/:userId */
  static getActivitySummaryByIdStatic = catchAsync(async (req, res) => {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) throw AppError.badRequest('Invalid user ID format');

    const tenantId = req.tenantId || req.user?.tenantId;
    const user = await User.findOne({ _id: userId, tenantId, isDeleted: false })
      .select('lastLogin loginCount loginHistory activeSessions securityEvents loyaltyPoints interests createdAt');
    if (!user) throw AppError.notFound('User not found');

    const summary = {
      userId:      user._id,
      lastLogin:   user.lastLogin,
      loginCount:  user.loginCount,
      accountAge:  Math.floor((Date.now() - new Date(user.createdAt)) / 86_400_000),
      loyaltyPoints: user.loyaltyPoints,
      activeSessionCount: (user.activeSessions || []).filter((s) => s.isActive).length,
      interestCount: (user.interests || []).length,
      recentLoginHistory: (user.loginHistory || []).sort((a, b) => new Date(b.loginTime) - new Date(a.loginTime)).slice(0, 5),
      activityLevel: UserController.getUserActivityLevel(user),
    };
    return sendSuccess(res, 'Activity summary', summary);
  });

  /** GET /api/users/analytics/users-with-analytics?limit=20&sortBy=loginFrequency */
  static getUsersWithAnalytics = catchAsync(async (req, res) => {
    const limit    = parseInt(req.query.limit, 10) || 20;
    const sortBy   = req.query.sortBy || 'loginFrequency';
    const tenantId = req.tenantId || req.user?.tenantId;

    const sortMap = {
      loginFrequency: { lastLogin: -1 },
      loyaltyPoints:  { loyaltyPoints: -1 },
      activity:       { updatedAt: -1 },
    };
    const sortObj = sortMap[sortBy] || { lastLogin: -1 };

    const users = await User.find({ tenantId, isDeleted: false })
      .populate('role', 'name')
      .sort(sortObj)
      .limit(limit);

    const enriched = users.map((u) => ({
      ...sanitizeUser(u),
      analytics: {
        profileCompleteness: UserController.calculateProfileCompleteness(u),
        activityLevel:       UserController.getUserActivityLevel(u),
        userScore:           UserController.calculateUserScore(u),
        securityScore:       UserController.calculateSecurityScore(u),
      },
    }));

    return sendSuccess(res, 'Users with analytics', enriched);
  });

  /** GET /api/users/analytics/all-stats — all user table stats in one call */
  static getAllTableStats = catchAsync(async (req, res) => {
    const tenantId     = req.tenantId || req.user?.tenantId;
    const trendDays    = req.query.trendDays;
    const interestLimit = req.query.interestLimit;
    const topUsersLimit = req.query.topUsersLimit;

    const data = await User.getAllTableStats({ tenantId, trendDays, interestLimit, topUsersLimit });
    return sendSuccess(res, 'All table stats retrieved', data);
  });

  /** GET /api/users/analytics/user-engagement?from=&to= */
  static getUserEngagementMetrics = catchAsync(async (req, res) => {
    const tenantId  = req.tenantId || req.user?.tenantId;
    const fromDate  = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 86_400_000);
    const toDate    = req.query.to   ? new Date(req.query.to)   : new Date();

    const [result] = await User.aggregate([
      { $match: { tenantId, isDeleted: false, createdAt: { $gte: fromDate, $lte: toDate } } },
      {
        $group: {
          _id: null,
          totalUsers:    { $sum: 1 },
          verifiedUsers: { $sum: { $cond: ['$isVerified', 1, 0] } },
          activeUsers:   { $sum: { $cond: [{ $eq: ['$status', 'active']}, 1, 0] } },
          avgLoyalty:    { $avg: '$loyaltyPoints' },
          premiumUsers:  { $sum: { $cond: [{ $eq: ['$subscriptionType', 'premium']}, 1, 0] } },
          mfaUsers:      { $sum: { $cond: ['$twoFactorAuth.enabled', 1, 0] } },
        },
      },
    ]);
    return sendSuccess(res, 'User engagement metrics', result || { totalUsers: 0 });
  });

  // ── Export / Import restructured ──────────────────────────────────────────

  /** GET /api/users/export/data */
  static exportUsersData = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const filters  = req.query.filters ? JSON.parse(req.query.filters) : {};
    const users    = await User.find({ tenantId, isDeleted: false, ...filters })
      .populate('role',    'name')
      .populate('address')
      .lean();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=users.json');
    return sendSuccess(res, 'Users exported', users.map(sanitizeUser));
  });

  /** GET /api/users/export/statistics */
  static exportUserStatistics = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;

    const [stats] = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      {
        $group: {
          _id: null,
          total:    { $sum: 1 },
          active:   { $sum: { $cond: [{ $eq: ['$status','active']}, 1, 0] } },
          verified: { $sum: { $cond: ['$isVerified', 1, 0] } },
          avgLoyalty: { $avg: '$loyaltyPoints' },
        },
      },
    ]);
    const roleCounts = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);
    const subCounts = await User.aggregate([
      { $match: { tenantId, isDeleted: false } },
      { $group: { _id: '$subscriptionType', count: { $sum: 1 } } },
    ]);

    const exportData = {
      overview:        stats || {},
      byRole:          roleCounts,
      bySubscription:  subCounts,
      exportedAt:      new Date(),
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=user-statistics.json');
    return sendSuccess(res, 'User statistics exported', exportData);
  });

  /** GET /api/users/export/csv */
  static exportCSV = catchAsync(async (req, res) => {
    const tenantId = req.tenantId || req.user?.tenantId;
    const users    = await User.find({ tenantId, isDeleted: false }).populate('role', 'name').lean();
    if (!users.length) throw AppError.notFound('No users to export');

    const rows  = users.map((u) => ({
      id:               u._id,
      username:         u.username,
      email:            u.email,
      firstName:        u.firstName  || '',
      lastName:         u.lastName   || '',
      status:           u.status,
      isVerified:       u.isVerified,
      role:             u.role?.name || '',
      loyaltyPoints:    u.loyaltyPoints,
      subscriptionType: u.subscriptionType || '',
      createdAt:        u.createdAt,
      lastLogin:        u.lastLogin || '',
    }));

    const headers = Object.keys(rows[0]).join(',');
    const csv     = [headers, ...rows.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
    return res.send(csv);
  });

  /** POST /api/users/import/data */
  static importUsersData = catchAsync(async (req, res) => {
    const { users } = req.body;
    if (!Array.isArray(users)) throw AppError.badRequest('users must be an array');

    const tenantId = req.tenantId || req.user?.tenantId;
    const results  = { created: 0, updated: 0, errors: [] };

    for (const userData of users) {
      try {
        const { email, password, ...rest } = userData;
        if (!email) { results.errors.push({ email: 'missing', error: 'email required' }); continue; }

        const existing = await User.findOne({ tenantId, email: email.toLowerCase(), isDeleted: false });
        if (existing) {
          Object.assign(existing, rest);
          existing.updated_by = req.userId;
          await existing.save();
          results.updated++;
        } else {
          if (!password) { results.errors.push({ email, error: 'password required for new users' }); continue; }
          const newUser = await User.registerNewUser({ email, password, ...rest }, tenantId);
          newUser.updated_by = req.userId;
          await newUser.save();
          results.created++;
        }
      } catch (err) {
        results.errors.push({ email: userData.email, error: err.message });
      }
    }

    return sendSuccess(res, 'Import completed', results);
  });

  /** POST /api/users/import/csv  — expects CSV text in req.body.csv */
  static importCSV = catchAsync(async (req, res) => {
    const { csv } = req.body;
    if (!csv || !csv.trim()) throw AppError.badRequest('csv field is required with CSV content');

    const tenantId = req.tenantId || req.user?.tenantId;
    const lines    = csv.trim().split('\n');
    const headers  = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());

    const rows = lines.slice(1).map((line) => {
      const values = line.match(/(".*?"|[^,]+)/g) || [];
      return headers.reduce((obj, key, i) => {
        obj[key] = (values[i] || '').replace(/"/g, '').trim();
        return obj;
      }, {});
    });

    const ops = rows
      .filter((r) => r.email)
      .map((row) => ({
        updateOne: {
          filter: { tenantId, email: row.email.toLowerCase() },
          update: { $set: row },
          upsert: true,
        },
      }));

    const result = await User.bulkWrite(ops);
    return sendSuccess(res, `Imported ${ops.length} users`, { upserted: result.upsertedCount, modified: result.modifiedCount });
  });
}

module.exports = UserController;
