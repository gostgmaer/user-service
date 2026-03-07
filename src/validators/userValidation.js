// src/validators/userValidation.js
'use strict';

const { body, query, param, validationResult } = require('express-validator');

/** Run accumulated validation errors and short-circuit on failure */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success:    false,
      statusCode: 422,
      message:    'Validation failed',
      error: {
        code:   'VALIDATION_ERROR',
        errors: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      },
    });
  }
  next();
};

// ── Reusable chains ───────────────────────────────────────────────────────────

const mongoId = (field) =>
  param(field).isMongoId().withMessage(`${field} must be a valid MongoDB ObjectId`);

// ── Validators ────────────────────────────────────────────────────────────────

const createUserValidation = [
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('A valid email is required'),
  body('firstName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('First name must be ≤ 50 characters'),
  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Last name must be ≤ 50 characters'),
  body('username')
    .optional()
    .trim()
    .isAlphanumeric('en-US', { ignore: '_-' })
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be 3-30 alphanumeric characters (underscore/dash allowed)'),
  body('role')
    .optional()
    .isIn(['customer','guest','user','vendor','staff','support_agent','moderator','manager','admin','super_admin'])
    .withMessage('Invalid role'),
  validate,
];

/** POST /api/users/register  — public self-registration; password is required */
const registerUserValidation = [
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('A valid email is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  body('firstName').optional().trim().isLength({ max: 50 }).withMessage('First name must be ≤ 50 characters'),
  body('lastName').optional().trim().isLength({ max: 50 }).withMessage('Last name must be ≤ 50 characters'),
  body('username')
    .optional()
    .trim()
    .isAlphanumeric('en-US', { ignore: '_-' })
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be 3-30 alphanumeric characters (underscore/dash allowed)'),
  validate,
];

const updateUserValidation = [
  mongoId('id'),
  body('email')
    .optional()
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('A valid email is required'),
  body('firstName').optional().trim().isLength({ max: 50 }),
  body('lastName').optional().trim().isLength({ max: 50 }),
  body('phoneNumber')
    .optional()
    .isMobilePhone('any', { strictMode: false })
    .withMessage('A valid phone number is required'),
  validate,
];

const changePasswordValidation = [
  mongoId('id'),
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters'),
  validate,
];

const listUsersValidation = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  query('sortBy').optional().isString().trim(),
  query('sortOrder').optional().isIn(['asc','desc', '1', '-1']),
  query('status').optional().isIn(['active','inactive','pending','banned','deleted']),
  query('role').optional().isString().trim(),
  query('search').optional().isString().trim().isLength({ max: 100 }),
  validate,
];

const searchValidation = [
  query('q').trim().isLength({ min: 2, max: 100 }).withMessage('Search query must be 2-100 characters'),
  validate,
];

const loyaltyValidation = [
  mongoId('id'),
  body('points').isInt({ min: 1 }).withMessage('Points must be a positive integer'),
  validate,
];

const addressValidation = [
  mongoId('id'),
  body('street').notEmpty().withMessage('Street is required'),
  body('city').notEmpty().withMessage('City is required'),
  body('country')
    .notEmpty()
    .isLength({ min: 2, max: 2 })
    .toUpperCase()
    .withMessage('Country must be a valid 2-letter ISO-3166 code'),
  body('isDefault').optional().isBoolean(),
  validate,
];

const bulkIdsValidation = [
  body('ids')
    .isArray({ min: 1 })
    .withMessage('ids must be a non-empty array')
    .custom((arr) => arr.every((id) => /^[a-f\d]{24}$/i.test(id)))
    .withMessage('All ids must be valid MongoDB ObjectIds'),
  validate,
];

const bulkUpdateValidation = [
  ...bulkIdsValidation.slice(0, -1), // reuse ids check, remove validate sentinel
  body('data').isObject().notEmpty().withMessage('data object is required'),
  validate,
];

const bulkStatusValidation = [
  ...bulkIdsValidation.slice(0, -1),
  body('status')
    .isIn(['active','inactive','pending','banned'])
    .withMessage('Invalid status value'),
  validate,
];

const importValidation = [
  body('users')
    .isArray({ min: 1 })
    .withMessage('users must be a non-empty array'),
  body('users.*.email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Each user must have a valid email'),
  validate,
];

const roleAssignValidation = [
  mongoId('userId'),
  body('roleId').isMongoId().withMessage('roleId must be a valid MongoDB ObjectId'),
  validate,
];

const preferencesValidation = [
  mongoId('id'),
  body('language').optional().isISO31661Alpha2().withMessage('Language must be a 2-letter ISO code'),
  body('currency').optional().isLength({ min: 3, max: 3 }).withMessage('Currency must be a 3-letter code'),
  body('theme').optional().isIn(['light','dark','system']).withMessage('Theme must be light, dark, or system'),
  body('newsletter').optional().isBoolean(),
  body('notifications').optional().isBoolean(),
  validate,
];

// ── New validators for Phase-4 routes ──────────────────────────────────────────

const statusValidation = [
  mongoId('id'),
  body('status')
    .isIn(['active', 'inactive', 'pending', 'banned', 'suspended'])
    .withMessage('status must be one of: active, inactive, pending, banned, suspended'),
  validate,
];

const subscriptionValidation = [
  mongoId('id'),
  body('type')
    .isIn(['free', 'basic', 'premium', 'enterprise'])
    .withMessage('type must be one of: free, basic, premium, enterprise'),
  body('startDate').optional().isISO8601().toDate().withMessage('startDate must be a valid ISO 8601 date'),
  body('endDate').optional().isISO8601().toDate().withMessage('endDate must be a valid ISO 8601 date'),
  validate,
];

const socialMediaLinkValidation = [
  mongoId('id'),
  body('provider')
    .trim()
    .notEmpty()
    .isIn(['google', 'facebook', 'twitter', 'github', 'linkedin', 'apple'])
    .withMessage('provider must be a supported OAuth provider'),
  body('socialId')
    .trim()
    .notEmpty()
    .isLength({ max: 256 })
    .withMessage('socialId is required and must be ≤ 256 characters'),
  validate,
];

const interestValidation = [
  mongoId('id'),
  body('interest')
    .trim()
    .notEmpty()
    .isLength({ min: 1, max: 100 })
    .withMessage('interest must be a non-empty string ≤ 100 characters'),
  validate,
];

const loyaltyTransferValidation = [
  mongoId('id'),
  body('toUserId')
    .isMongoId()
    .withMessage('toUserId must be a valid MongoDB ObjectId'),
  body('points')
    .isInt({ min: 1 })
    .withMessage('points must be a positive integer'),
  validate,
];

const notifyValidation = [
  mongoId('id'),
  body('title')
    .trim()
    .notEmpty()
    .isLength({ max: 200 })
    .withMessage('title is required and must be ≤ 200 characters'),
  body('message')
    .trim()
    .notEmpty()
    .isLength({ max: 2000 })
    .withMessage('message is required and must be ≤ 2000 characters'),
  body('type')
    .optional()
    .isIn(['info', 'warning', 'success', 'error'])
    .withMessage('type must be one of: info, warning, success, error'),
  validate,
];

const lockAccountValidation = [
  mongoId('id'),
  body('durationMs')
    .optional()
    .isInt({ min: 60000 })
    .withMessage('durationMs must be at least 60000 (1 minute)'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('reason must be ≤ 500 characters'),
  validate,
];

const themeValidation = [
  mongoId('id'),
  body('theme')
    .isIn(['light', 'dark', 'system'])
    .withMessage('theme must be one of: light, dark, system'),
  validate,
];

const languageValidation = [
  mongoId('id'),
  body('language')
    .trim()
    .isISO31661Alpha2()
    .withMessage('language must be a valid 2-letter ISO 639-1 language code'),
  validate,
];

const allStatsValidation = [
  query('trendDays').optional().isInt({ min: 1, max: 365 }).toInt()
    .withMessage('trendDays must be an integer between 1 and 365'),
  query('interestLimit').optional().isInt({ min: 1, max: 100 }).toInt()
    .withMessage('interestLimit must be an integer between 1 and 100'),
  query('topUsersLimit').optional().isInt({ min: 1, max: 50 }).toInt()
    .withMessage('topUsersLimit must be an integer between 1 and 50'),
  validate,
];

module.exports = {
  validate,
  createUserValidation,
  registerUserValidation,
  updateUserValidation,
  changePasswordValidation,
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
  // ── New validators ──────────────────────────────────────────────────────────
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
};
