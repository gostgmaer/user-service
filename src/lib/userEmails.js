// src/lib/userEmails.js
// Centralised email dispatch for all user-service events.
// Each function maps one business action → one templateId sent via the Email Microservice.
// All functions are non-fatal: errors are logged but never re-thrown so the
// calling controller operation always completes successfully.
'use strict';

const { sendEmail } = require('./emailClient');

// ── Template ID constants ────────────────────────────────────────────────────
// Values must match the template identifiers exported by the Email Microservice.
const TEMPLATES = {
  // Registration & onboarding
  USER_INVITE:             'USER_CREATED',           // admin creates a user

  // Profile changes
  EMAIL_CHANGED:           'emailChangedTemplate',
  PHONE_CHANGED:           'phoneNumberChangeConfirmationTemplate',

  // Account security / status
  ACCOUNT_LOCKED:          'accountLockedTemplate',
  ACCOUNT_UNLOCKED:        'ACCOUNT_UNLOCKED',
  ACCOUNT_DEACTIVATED:     'accountDeactivationWarningTemplate',
  ACCOUNT_REACTIVATED:     'accountReactivatedTemplate',

  // Access control
  ROLE_CHANGED:            'ROLE_ASSIGNED',

  // Subscriptions
  SUBSCRIPTION_UPDATED:    'subscriptionUpdatedTemplate',
  SUBSCRIPTION_CANCELLED:  'subscriptionCancelledTemplate',

  // Loyalty
  LOYALTY_CREDITED:        'loyaltyPointsEarnedTemplate',   // add / transfer-in
  LOYALTY_REDEEMED:        'loyaltyPointsRedeemedTemplate', // redeem / transfer-out
  LOYALTY_TRANSFER_OUT:    'LOYALTY_POINTS_REDEEMED',       // points left the account
  LOYALTY_TRANSFER_IN:     'loyaltyPointsEarnedTemplate',   // points arrived
  LOYALTY_RESET:           'LOYALTY_POINTS_REDEEMED',       // admin zeroed points

  // Account lifecycle
  ACCOUNT_DELETED:         'accountDeletedTemplate',

  // Verification
  USER_VERIFIED:           'accountVerifiedTemplate',

  // Profile
  PROFILE_PICTURE_UPDATED: 'PROFILE_PICTURE_UPDATED',

  // Newsletter
  NEWSLETTER_SUBSCRIBED:   'newsletterTemplate',
  NEWSLETTER_UNSUBSCRIBED: 'newsletterTemplate',

  // Social accounts
  SOCIAL_LINKED:           'socialLoginConnectionTemplate',
  SOCIAL_UNLINKED:         'SOCIAL_LOGIN_DISCONNECTED',

  // Sessions
  SESSIONS_INVALIDATED:    'logoutAllDevicesTemplate',

  // General in-app notification delivered via email
  NOTIFICATION:            'MESSAGE_RECEIVED',
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Friendly display name for a user object */
const displayName = (user) =>
  user.firstName || user.username || user.email;

// ── Exported email functions ─────────────────────────────────────────────────

/**
 * Invite email when an admin creates a new user account.
 * @param {object} user - Newly created user document
 */
const emailUserInvite = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.USER_INVITE,
    data: {
      name:     displayName(user),
      username: user.username,
      email:    user.email,
    },
  });

/**
 * Notify the user that their email address was changed.
 * @param {object} user      - User document (carries the NEW email)
 * @param {string} oldEmail  - Previous email address
 */
const emailEmailChanged = (user, oldEmail) =>
  sendEmail({
    to:         user.email,          // send to the new address
    templateId: TEMPLATES.EMAIL_CHANGED,
    data: {
      name:     displayName(user),
      newEmail: user.email,
      oldEmail,
    },
  });

/**
 * Notify the user that their phone number was changed.
 * @param {object} user - User document
 */
const emailPhoneChanged = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.PHONE_CHANGED,
    data: {
      name:        displayName(user),
      phoneNumber: user.phoneNumber,
    },
  });

/**
 * Notify the user that their account has been locked.
 * @param {object} user        - User document
 * @param {Date}   lockedUntil - Timestamp when the lock expires
 */
const emailAccountLocked = (user, lockedUntil) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.ACCOUNT_LOCKED,
    data: {
      name:        displayName(user),
      lockedUntil: lockedUntil ? new Date(lockedUntil).toUTCString() : 'until further notice',
    },
  });

/**
 * Notify the user that their account lock has been lifted.
 * @param {object} user - User document
 */
const emailAccountUnlocked = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.ACCOUNT_UNLOCKED,
    data: { name: displayName(user) },
  });

/**
 * Notify the user that their account has been deactivated.
 * @param {object} user   - User document
 * @param {string} reason - Optional reason provided by admin
 */
const emailAccountDeactivated = (user, reason) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.ACCOUNT_DEACTIVATED,
    data: {
      name:   displayName(user),
      reason: reason || 'No reason provided',
    },
  });

/**
 * Notify the user that their account has been reactivated.
 * @param {object} user - User document
 */
const emailAccountReactivated = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.ACCOUNT_REACTIVATED,
    data: { name: displayName(user) },
  });

/**
 * Notify the user that their role has been changed.
 * @param {object} user    - User document (role must be populated with .name)
 * @param {string} newRole - Human-readable role name
 */
const emailRoleChanged = (user, newRole) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.ROLE_CHANGED,
    data: {
      name:    displayName(user),
      newRole: newRole || user.role?.name || 'updated',
    },
  });

/**
 * Notify the user that their subscription has been updated.
 * @param {object} user - User document (subscriptionType must already be set)
 */
const emailSubscriptionUpdated = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.SUBSCRIPTION_UPDATED,
    data: {
      name:             displayName(user),
      subscriptionType: user.subscriptionType,
    },
  });

/**
 * Notify the user that their subscription has been cancelled.
 * @param {object} user - User document
 */
const emailSubscriptionCancelled = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.SUBSCRIPTION_CANCELLED,
    data: { name: displayName(user) },
  });

/**
 * Notify the user that loyalty points were credited to their account.
 * @param {object} user   - User document
 * @param {number} points - Points added in this transaction
 */
const emailLoyaltyCredit = (user, points) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.LOYALTY_CREDITED,
    data: {
      name:          displayName(user),
      pointsAdded:   points,
      totalPoints:   user.loyaltyPoints,
    },
  });

/**
 * Notify the user that loyalty points were redeemed.
 * @param {object} user   - User document
 * @param {number} points - Points redeemed in this transaction
 */
const emailLoyaltyRedeem = (user, points) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.LOYALTY_REDEEMED,
    data: {
      name:           displayName(user),
      pointsRedeemed: points,
      totalPoints:    user.loyaltyPoints,
    },
  });

/**
 * Notify the sender that they have transferred loyalty points.
 * @param {object} fromUser - Sender user document
 * @param {object} toUser   - Recipient user document
 * @param {number} points   - Points transferred
 */
const emailLoyaltyTransferOut = (fromUser, toUser, points) =>
  sendEmail({
    to:         fromUser.email,
    templateId: TEMPLATES.LOYALTY_TRANSFER_OUT,
    data: {
      name:          displayName(fromUser),
      recipientName: displayName(toUser),
      pointsSent:    points,
      totalPoints:   fromUser.loyaltyPoints,
    },
  });

/**
 * Notify the recipient that they have received loyalty points.
 * @param {object} toUser   - Recipient user document
 * @param {object} fromUser - Sender user document
 * @param {number} points   - Points received
 */
const emailLoyaltyTransferIn = (toUser, fromUser, points) =>
  sendEmail({
    to:         toUser.email,
    templateId: TEMPLATES.LOYALTY_TRANSFER_IN,
    data: {
      name:         displayName(toUser),
      senderName:   displayName(fromUser),
      pointsReceived: points,
      totalPoints:  toUser.loyaltyPoints,
    },
  });

/**
 * Notify the user that their loyalty points have been reset by an admin.
 * @param {object} user - User document
 */
const emailLoyaltyReset = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.LOYALTY_RESET,
    data: { name: displayName(user) },
  });

/**
 * Notify the user that all their active sessions have been invalidated.
 * @param {object} user - User document
 */
const emailSessionsInvalidated = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.SESSIONS_INVALIDATED,
    data: { name: displayName(user) },
  });

/**
 * Notify the user that their account has been permanently deleted.
 * @param {object} user - User document (snapshot before deletion)
 */
const emailAccountDeleted = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.ACCOUNT_DELETED,
    data: { name: displayName(user) },
  });

/**
 * Notify the user that their account has been manually verified by an admin.
 * @param {object} user - User document
 */
const emailUserVerified = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.USER_VERIFIED,
    data: { name: displayName(user) },
  });

/**
 * Notify the user that their profile picture was updated.
 * @param {object} user - User document
 */
const emailProfilePictureUpdated = (user) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.PROFILE_PICTURE_UPDATED,
    data: { name: displayName(user) },
  });

/**
 * Confirm newsletter subscription preference change.
 * @param {object}  user       - User document
 * @param {boolean} subscribed - true = subscribed, false = unsubscribed
 */
const emailNewsletterPreference = (user, subscribed) =>
  sendEmail({
    to:         user.email,
    templateId: subscribed ? TEMPLATES.NEWSLETTER_SUBSCRIBED : TEMPLATES.NEWSLETTER_UNSUBSCRIBED,
    data: {
      name:       displayName(user),
      subscribed: subscribed ? 'subscribed to' : 'unsubscribed from',
    },
  });

/**
 * Notify the user that a social account was linked.
 * @param {object} user     - User document
 * @param {string} platform - Social platform name (e.g. 'google', 'facebook')
 */
const emailSocialLinked = (user, platform) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.SOCIAL_LINKED,
    data: {
      name:     displayName(user),
      platform,
    },
  });

/**
 * Notify the user that a social account was unlinked.
 * @param {object} user     - User document
 * @param {string} platform - Social platform name
 */
const emailSocialUnlinked = (user, platform) =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.SOCIAL_UNLINKED,
    data: {
      name:     displayName(user),
      platform,
    },
  });

/**
 * Send a custom in-app notification via email.
 * @param {object} user    - User document
 * @param {string} title   - Notification title
 * @param {string} message - Notification body
 * @param {string} type    - Notification type (info | warning | success | error)
 */
const emailNotification = (user, title, message, type = 'info') =>
  sendEmail({
    to:         user.email,
    templateId: TEMPLATES.NOTIFICATION,
    data: {
      name: displayName(user),
      title,
      message,
      type,
    },
  });

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  TEMPLATES,
  emailUserInvite,
  emailEmailChanged,
  emailPhoneChanged,
  emailAccountLocked,
  emailAccountUnlocked,
  emailAccountDeactivated,
  emailAccountReactivated,
  emailRoleChanged,
  emailSubscriptionUpdated,
  emailSubscriptionCancelled,
  emailLoyaltyCredit,
  emailLoyaltyRedeem,
  emailLoyaltyTransferOut,
  emailLoyaltyTransferIn,
  emailLoyaltyReset,
  emailSessionsInvalidated,
  emailAccountDeleted,
  emailUserVerified,
  emailProfilePictureUpdated,
  emailNewsletterPreference,
  emailSocialLinked,
  emailSocialUnlinked,
  emailNotification,
};
