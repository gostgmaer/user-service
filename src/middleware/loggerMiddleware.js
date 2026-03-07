// src/middleware/loggerMiddleware.js
'use strict';

const logger = require('../services/logger');

const loggerMiddleware = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger[level](`${req.method} ${req.originalUrl}`, {
      statusCode: res.statusCode,
      duration:   `${duration}ms`,
      ip:         req.ip,
      userId:     req.userId?.toString(),
      requestId:  req.requestId,
    });
  });

  next();
};

module.exports = { loggerMiddleware };
