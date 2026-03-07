// src/services/NotificationService.js
// Notification hooks called as Express middleware after CRUD operations.
'use strict';

const logger = require('./logger');

class NotificationService {
  static onUserCreate(req, res, next) {
    // Emit a user.created event or call a notification microservice here
    if (res.locals.createdUser) {
      logger.info('[Notify] user.created', { userId: res.locals.createdUser._id?.toString() });
    }
    next();
  }

  static onUserUpdate(req, res, next) {
    if (res.locals.updatedUser) {
      logger.info('[Notify] user.updated', { userId: res.locals.updatedUser._id?.toString() });
    }
    next();
  }

  static onUserDelete(req, res, next) {
    logger.info('[Notify] user.deleted', { userId: req.params.id });
    next();
  }
}

module.exports = NotificationService;
