// src/config/db.js
'use strict';

const mongoose = require('mongoose');
const logger   = require('../services/logger');
const env      = require('./env');

const connectDB = async () => {
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      await mongoose.connect(env.MONGO_URI, {
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      logger.info('MongoDB connected (user-service)');
      return;
    } catch (err) {
      attempt++;
      logger.warn(`MongoDB connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      } else {
        logger.error('MongoDB connection failed after max retries');
        throw err;
      }
    }
  }
};

const disconnectDB = async () => {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
};

const isConnected = () => mongoose.connection.readyState === 1;

module.exports = { connectDB, disconnectDB, isConnected };
