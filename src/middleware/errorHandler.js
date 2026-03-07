// src/middleware/errorHandler.js
'use strict';

const AppError = require('../utils/appError');
const logger   = require('../services/logger');
const env      = require('../config/env');

const errorHandler = (err, req, res, next) => {
  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {}).join(', ');
    err = AppError.conflict(`Duplicate value for: ${field}`);
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    err = AppError.validation('Validation failed', messages);
  }

  // Mongoose cast error (e.g. invalid ObjectId)
  if (err.name === 'CastError') {
    err = AppError.badRequest(`Invalid ${err.path}: ${err.value}`);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') err = AppError.unauthorized('Invalid token');
  if (err.name === 'TokenExpiredError') err = AppError.unauthorized('Token has expired', 'TOKEN_EXPIRED');
  if (err.name === 'NotBeforeError')    err = AppError.unauthorized('Token not yet valid');

  const statusCode    = err.statusCode || 500;
  const isOperational = err.isOperational ?? false;

  if (statusCode >= 500) {
    logger.error('Server error', {
      statusCode,
      message: err.message,
      stack:   err.stack,
      url:     req.originalUrl,
      method:  req.method,
      userId:  req.user?._id?.toString(),
    });
  }

  const response = {
    success: false,
    statusCode,
    message: isOperational || !env.IS_PROD ? err.message : 'An unexpected error occurred',
    error: { code: err.code || 'INTERNAL_ERROR' },
  };

  if (err.validationErrors)        response.error.errors  = err.validationErrors;
  if (err.details && !env.IS_PROD) response.error.details = err.details;
  if (!env.IS_PROD && !isOperational) response.error.stack = err.stack;

  if (req.requestId) res.setHeader('X-Request-Id', req.requestId);
  res.status(statusCode).json(response);
};

// Wraps async route handlers — forwards any thrown error to globalErrorHandler
const catchAsync = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, catchAsync };
