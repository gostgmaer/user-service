// src/services/logger.js
'use strict';

const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const env  = require('../config/env');

const isPretty = env.LOG_FORMAT === 'pretty' || env.IS_DEV;

const prettyFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const transports = [new winston.transports.Console()];

// In production add rotating file transports
if (env.IS_PROD) {
  const logsDir = path.join(process.cwd(), 'logs');

  transports.push(
    new winston.transports.DailyRotateFile({
      filename:     path.join(logsDir, 'app-%DATE%.log'),
      datePattern:  'YYYY-MM-DD',
      zippedArchive: true,
      maxSize:      '20m',
      maxFiles:     '14d',
      level:        'info',
    }),
    new winston.transports.DailyRotateFile({
      filename:     path.join(logsDir, 'error-%DATE%.log'),
      datePattern:  'YYYY-MM-DD',
      zippedArchive: true,
      maxSize:      '20m',
      maxFiles:     '30d',
      level:        'error',
    })
  );
}

const logger = winston.createLogger({
  level:      env.LOG_LEVEL || 'info',
  format:     isPretty ? prettyFormat : jsonFormat,
  defaultMeta: { service: env.SERVICE_NAME || 'user-service' },
  transports,
});

module.exports = logger;
