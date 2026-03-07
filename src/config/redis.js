// src/config/redis.js
'use strict';

const Redis  = require('ioredis');
const logger = require('../services/logger');
const env    = require('./env');

let redisClient = null;

const getRedisClient = () => {
  if (redisClient) return redisClient;
  if (!env.REDIS_URL) return null;

  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 5) return null;
      return Math.min(times * 500, 2000);
    },
  });

  redisClient.on('connect', () => logger.info('Redis connected'));
  redisClient.on('error',   (err) => logger.warn('Redis error (non-fatal)', { message: err.message }));

  return redisClient;
};

const isRedisReady = async () => {
  const client = getRedisClient();
  if (!client) return false;
  try {
    await client.ping();
    return true;
  } catch {
    return false;
  }
};

module.exports = { getRedisClient, isRedisReady };
