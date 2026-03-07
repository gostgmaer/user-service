// src/routes/userRoutes.js
'use strict';

const router = require('express').Router();
const { param } = require('express-validator');

const UserController = require('../controller/consolidatedUserController');
const { authMiddleware, serviceAuthMiddleware } = require('../middleware/auth');
const { authorize } = require('../middleware/authorize');
const { bulkOperationLimiter } = require('../middleware/rateLimit');
const {
  createUserValidation,
  updateUserValidation,
  listUsersValidation,
  searchValidation,
  loyaltyValidation,
  addressValidation,
  bulkIdsValidation,
  bulkUpdateValidation,
  bulkStatusValidation,
  importValidation,
  roleAssignValidation,
  preferencesValidation,
  statusValidation,
  subscriptionValidation,
  socialMediaLinkValidation,
  interestValidation,
  loyaltyTransferValidation,
  notifyValidation,
  lockAccountValidation,
  themeValidation,
  languageValidation,
  allStatsValidation,
} = require('../validators/userValidation');
const { validate } = require('../validators/userValidation');

// Guard: user can only act on their own data unless they are admin/super_admin
const instanceCheck = (req, res, next) => {
  const targetId = req.params.id || req.params.userId;
  if (!targetId) return next();

  const isAdmin = req.user && ['super_admin','admin'].includes(req.user.role);
  const isOwner = req.user && String(req.user._id) === String(targetId);

  if (!isAdmin && !isOwner) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  next();
};

const validMongoId = (field) => [
  param(field).isMongoId().withMessage(`${field} must be a valid MongoDB ObjectId`),
  validate,
];

// ── Auth Required ─────────────────────────────────────────────────────────────
router.use(authMiddleware);

// ── Stats / analytics (admin only) ───────────────────────────────────────────
router.get('/stats-data',   authorize('users', 'view'), UserController.getUserStats);
router.get('/analytics',    authorize('users', 'view'), UserController.getDashboardStats);

// ── List & search (admin) ─────────────────────────────────────────────────────
router.get('/',        authorize('users', 'read'), listUsersValidation, UserController.getUsers);
router.get('/search',  authorize('users', 'read'), searchValidation, UserController.searchUsers);

// ── Lookup helpers (admin / service) ─────────────────────────────────────────
router.get('/by-email/:email',
  authorize('users', 'read'),
  param('email').isEmail().normalizeEmail().withMessage('email must be a valid email address'),
  validate,
  UserController.findByEmail);
router.get('/by-username/:username',
  authorize('users', 'read'),
  param('username').trim().isAlphanumeric('en-US', { ignore: '_-' }).isLength({ min: 3, max: 30 })
    .withMessage('username must be 3–30 alphanumeric characters (underscore/dash allowed)'),
  validate,
  UserController.findByUsername);

// ── Bulk operations (admin) ───────────────────────────────────────────────────
router.delete('/bulk',       bulkOperationLimiter, authorize('users','delete'), bulkIdsValidation,   UserController.bulkDeleteUsers);
router.put('/bulk',          bulkOperationLimiter, authorize('users','update'), bulkUpdateValidation, UserController.bulkUpdateUsers);
router.patch('/bulk/status', bulkOperationLimiter, authorize('users','update'), bulkStatusValidation, UserController.bulkUpdateStatus);


// ── Admin: create user ────────────────────────────────────────────────────────
router.post('/', authorize('users','create'), createUserValidation, UserController.createUser);

// ── Authentication sub-routes (no :id — operate on the caller) ───────────────
// NOTE: reset-password and confirm-email are owned by the Auth Microservice.
//       Route them there; do not duplicate them here.

// ── Own profile ───────────────────────────────────────────────────────────────
router.get('/profile', UserController.getMyProfileStatisticsController);

// ── Per-user routes (:id) ─────────────────────────────────────────────────────
router.get('/:id',    ...validMongoId('id'), instanceCheck, UserController.getUserByIdentifier);
router.put('/:id',    ...validMongoId('id'), instanceCheck, updateUserValidation, UserController.updateUser);
router.patch('/:id',  ...validMongoId('id'), instanceCheck, updateUserValidation, UserController.updateUser);
router.delete('/:id', ...validMongoId('id'), authorize('users','delete'), UserController.deleteUser);

// Profile sub-routes
router.put('/:id/profile',         ...validMongoId('id'), instanceCheck, UserController.updateProfile);
router.put('/:id/profile/picture', ...validMongoId('id'), instanceCheck, UserController.updateProfilePicture);
router.put('/:id/profile/email',   ...validMongoId('id'), instanceCheck, UserController.updateEmail);
router.put('/:id/profile/phone',   ...validMongoId('id'), instanceCheck, UserController.updatePhoneNumber);

// Authentication sub-routes
// NOTE: change-password is owned by the Auth Microservice.
router.put('/:id/authentication/verify',          ...validMongoId('id'), authorize('users','update'), UserController.verifyUser);

// Role
router.patch('/:userId/role', ...validMongoId('userId'), authorize('users','manage'), roleAssignValidation, UserController.assignUserRoleById);

// Preferences
router.put('/:id/preferences', ...validMongoId('id'), instanceCheck, preferencesValidation, UserController.updatePreferences);

// ── Search extras (before /:id to avoid param capture) ───────────────────────
router.get('/search/email-username', authorize('users', 'read'), UserController.searchByEmailOrUsername);
router.get('/search/dynamic',        authorize('users', 'read'), UserController.dynamicSearch);
router.get('/advanced-search',       authorize('users', 'read'), UserController.advancedSearch);

// ── Filter routes (admin) ─────────────────────────────────────────────────────
router.get('/filter/status',               authorize('users', 'read'), UserController.getUsersByStatus);
router.get('/filter/active',               authorize('users', 'read'), UserController.getActiveUsers);
router.get('/filter/verified',             authorize('users', 'read'), UserController.getVerifiedUsers);
router.get('/filter/role',                 authorize('users', 'read'), UserController.getUsersByRole);
router.get('/filter/admins',               authorize('users', 'read'), UserController.getAdmins);
router.get('/filter/customers',            authorize('users', 'read'), UserController.getCustomers);
router.get('/filter/subscription',         authorize('users', 'read'), UserController.getUsersBySubscriptionType);
router.get('/filter/active-within-days',   authorize('users', 'read'), UserController.findActiveWithinDays);
router.get('/filter/top-loyal',            authorize('users', 'read'), UserController.getTopLoyalUsers);
router.get('/filter/never-logged-in',      authorize('users', 'read'), UserController.getNeverLoggedInUsers);
router.get('/filter/oldest',               authorize('users', 'read'), UserController.findOldestUser);
router.get('/filter/failed-logins',        authorize('users', 'read'), UserController.findUsersWithFailedLogins);
router.get('/filter/incomplete-profiles',  authorize('users', 'read'), UserController.findUsersWithIncompleteProfiles);

// ── Bulk extras ───────────────────────────────────────────────────────────────
router.put('/bulk/update-role',          bulkOperationLimiter, authorize('users','update'), UserController.bulkUpdateRole);
router.post('/bulk/add-loyalty-points',  bulkOperationLimiter, authorize('users','update'), UserController.bulkAddLoyaltyPoints);

// ── Analytics (admin) ─────────────────────────────────────────────────────────
router.get('/analytics/count-by-role',          authorize('users', 'view'), UserController.getUserCountByRole);
router.get('/analytics/count-by-subscription',  authorize('users', 'view'), UserController.getUserCountBySubscription);
router.get('/analytics/count-by-country',       authorize('users', 'view'), UserController.getUserCountByCountry);
router.get('/analytics/average-loyalty-points', authorize('users', 'view'), UserController.getAverageLoyaltyPoints);
router.get('/analytics/average-orders',         authorize('users', 'view'), UserController.getAverageOrdersPerUser);
router.get('/analytics/loyalty-brackets',       authorize('users', 'view'), UserController.getUserLoyaltyBrackets);
router.get('/analytics/top-interests',          authorize('users', 'view'), UserController.getTopUserInterests);
router.get('/analytics/registrations-over-time', authorize('users', 'view'), UserController.getRegistrationsOverTime);
router.get('/analytics/login-activity-over-time', authorize('users', 'view'), UserController.getLoginActivityOverTime);
router.get('/analytics/table-statistics',       authorize('users', 'view'), UserController.getTableStatistics);
router.get('/analytics/table-report',           authorize('users', 'view'), UserController.getTableReport);
router.get('/analytics/user-report/:userId',    authorize('users', 'view'), ...validMongoId('userId'), UserController.getUserReportByIdStatic);
router.get('/analytics/activity-summary/:userId', authorize('users', 'view'), ...validMongoId('userId'), UserController.getActivitySummaryByIdStatic);
router.get('/analytics/users-with-analytics',   authorize('users', 'view'), UserController.getUsersWithAnalytics);
router.get('/analytics/user-engagement',        authorize('users', 'view'), UserController.getUserEngagementMetrics);
router.get('/analytics/all-stats',              authorize('users', 'view'), allStatsValidation, UserController.getAllTableStats);

// ── Export / Import ───────────────────────────────────────────────────────────
router.get('/export/data',        bulkOperationLimiter, authorize('users','export'), UserController.exportUsersData);
router.get('/export/statistics',  bulkOperationLimiter, authorize('users','export'), UserController.exportUserStatistics);
router.get('/export/csv',         bulkOperationLimiter, authorize('users','export'), UserController.exportCSV);
router.post('/import/data',       bulkOperationLimiter, authorize('users','import'), UserController.importUsersData);
router.post('/import/csv',        bulkOperationLimiter, authorize('users','import'), UserController.importCSV);

// ── Account status routes (per-user) ─────────────────────────────────────────
router.put('/:id/status',             ...validMongoId('id'), authorize('users','update'), statusValidation, UserController.updateStatus);
router.put('/:id/deactivate-account', ...validMongoId('id'), authorize('users','update'), UserController.deactivateAccount);
router.put('/:id/reactivate-account', ...validMongoId('id'), authorize('users','update'), UserController.reactivateAccount);
router.patch('/:userId/activate',     ...validMongoId('userId'), authorize('users','update'), UserController.activateUser);
router.patch('/:userId/deactivate',   ...validMongoId('userId'), authorize('users','update'), UserController.deactivateUser);
router.put('/:id/lock',               ...validMongoId('id'), authorize('users','update'), lockAccountValidation, UserController.lockAccount);
router.put('/:id/unlock',             ...validMongoId('id'), authorize('users','update'), UserController.unlockAccount);

// ── Subscription ──────────────────────────────────────────────────────────────
router.put('/:id/subscription',    ...validMongoId('id'), authorize('users','update'), subscriptionValidation, UserController.updateSubscription);
router.delete('/:id/subscription', ...validMongoId('id'), authorize('users','update'), UserController.cancelSubscription);

// ── Preference sub-routes ─────────────────────────────────────────────────────
router.put('/:id/preferences/newsletter',   ...validMongoId('id'), instanceCheck, UserController.toggleNewsletterSubscription);
router.put('/:id/preferences/notifications', ...validMongoId('id'), instanceCheck, UserController.toggleNotifications);
router.put('/:id/preferences/theme',        ...validMongoId('id'), instanceCheck, themeValidation, UserController.setThemePreference);
router.put('/:id/preferences/language',     ...validMongoId('id'), instanceCheck, languageValidation, UserController.updateLanguagePreference);

// ── Loyalty extras ────────────────────────────────────────────────────────────
router.post('/:id/loyalty/transfer', ...validMongoId('id'), instanceCheck, loyaltyTransferValidation, UserController.transferLoyaltyPoints);
router.put('/:id/loyalty/reset',     ...validMongoId('id'), authorize('users','update'), UserController.resetLoyaltyPoints);

// ── Interests ─────────────────────────────────────────────────────────────────
router.post('/:id/interests',           ...validMongoId('id'), instanceCheck, interestValidation, UserController.addInterest);
router.delete('/:id/interests',         ...validMongoId('id'), instanceCheck, UserController.removeInterest);
router.post('/:id/interests/category',  ...validMongoId('id'), instanceCheck, UserController.addInterestCategory);
router.delete('/:id/interests/clear',   ...validMongoId('id'), instanceCheck, UserController.clearInterests);

// ── Session / Security extras ─────────────────────────────────────────────────
router.post('/:id/sessions/invalidate-all', ...validMongoId('id'), bulkOperationLimiter, authorize('users','update'), UserController.invalidateAllSessions);
router.post('/:id/sessions/revoke-token',   ...validMongoId('id'), instanceCheck, UserController.revokeToken);
router.put('/:id/login-timestamp',          ...validMongoId('id'), authorize('users','update'), UserController.updateLoginTimestamp);
router.put('/:id/failed-logins/increment',  ...validMongoId('id'), authorize('users','update'), UserController.incrementFailedLogins);
router.put('/:id/failed-logins/reset',      ...validMongoId('id'), authorize('users','update'), UserController.resetFailedLogins);

// ── Reporting (per-user) ──────────────────────────────────────────────────────
router.get('/:id/statistics',     ...validMongoId('id'), instanceCheck, UserController.getUserStatistics);
router.get('/:id/report',         ...validMongoId('id'), instanceCheck, UserController.getUserReport);
router.get('/:id/activity-summary', ...validMongoId('id'), instanceCheck, UserController.getActivitySummary);
router.put('/:id/dynamic-update', ...validMongoId('id'), authorize('users','update'), UserController.dynamicUpdate);

// ── Social Media ──────────────────────────────────────────────────────────────
router.put('/:id/social-media',          ...validMongoId('id'), instanceCheck, UserController.updateSocialMedia);
router.post('/:id/social-media/link',    ...validMongoId('id'), instanceCheck, socialMediaLinkValidation, UserController.linkSocialAccount);
router.delete('/:id/social-media/unlink', ...validMongoId('id'), instanceCheck, UserController.unlinkSocialAccount);
router.delete('/:id/social-media/clear', ...validMongoId('id'), authorize('users','update'), UserController.clearAllSocialLinks);

// ── Notification ──────────────────────────────────────────────────────────────
router.post('/:id/notify', ...validMongoId('id'), authorize('users','update'), notifyValidation, UserController.sendNotification);


// Favorites
router.post('/:id/favorites',   ...validMongoId('id'), instanceCheck, UserController.addFavoriteProduct);
router.delete('/:id/favorites', ...validMongoId('id'), instanceCheck, UserController.removeFavoriteProduct);

// Loyalty
router.post('/:id/loyalty/add',    ...validMongoId('id'), authorize('users','update'), loyaltyValidation, UserController.addLoyaltyPoints);
router.post('/:id/loyalty/redeem', ...validMongoId('id'), instanceCheck, loyaltyValidation, UserController.redeemLoyaltyPoints);

// Addresses
router.post('/:id/addresses',                              ...validMongoId('id'), instanceCheck, addressValidation, UserController.addAddress);
router.put('/:id/addresses/:addressId',                    ...validMongoId('id'), ...validMongoId('addressId'), instanceCheck, UserController.updateAddress);
router.delete('/:id/addresses/:addressId',                 ...validMongoId('id'), ...validMongoId('addressId'), instanceCheck, UserController.removeAddress);
router.patch('/:id/addresses/:addressId/default',          ...validMongoId('id'), ...validMongoId('addressId'), instanceCheck, UserController.setDefaultAddress);

// Security & Sessions
router.get('/:id/security',         ...validMongoId('id'), instanceCheck, UserController.getSecurityInfo);
router.get('/:id/sessions',         ...validMongoId('id'), instanceCheck, UserController.getActiveSessions);
router.get('/:id/devices/trusted',  ...validMongoId('id'), instanceCheck, UserController.getTrustedDevices);
router.get('/:id/devices/known',    ...validMongoId('id'), instanceCheck, UserController.getKnownDevices);
router.get('/:id/login-history',    ...validMongoId('id'), instanceCheck, UserController.getLoginHistory);
router.get('/:id/security/logs',    ...validMongoId('id'), authorize('users','read'), UserController.getSecurityLogs);

// Social
router.get('/:id/social', ...validMongoId('id'), instanceCheck, UserController.getSocialAccounts);

module.exports = router;
