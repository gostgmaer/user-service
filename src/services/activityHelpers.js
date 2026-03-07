// src/services/activityHelpers.js
'use strict';

const logger = require('./logger');

class ActivityHelper {
  static logCRUD(req, modelName, action, details = {}) {
    logger.info(`[Activity] ${action} on ${modelName}`, {
      userId:    req.userId?.toString() || 'system',
      tenantId:  req.tenantId,
      model:     modelName,
      action,
      requestId: req.requestId,
      ...details,
    });
  }

  static logUserAction(userId, action, metadata = {}) {
    logger.info(`[UserAction] ${action}`, {
      userId: String(userId),
      action,
      ...metadata,
    });
  }
}

module.exports = ActivityHelper;
