// src/lib/serviceClient.js
// Internal service-to-service HTTP client.
// Automatically attaches x-api-key and x-service-name headers.
'use strict';

const axios  = require('axios');
const env    = require('../config/env');
const logger = require('../services/logger');

const serviceClient = axios.create({
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key':      env.SERVICE_API_KEY,
    'x-service-name': env.SERVICE_NAME,
  },
});

serviceClient.interceptors.request.use((config) => {
  logger.info(`[ServiceClient] → ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

serviceClient.interceptors.response.use(
  (response) => response,
  (error) => {
    logger.error('[ServiceClient] Request failed', {
      url:     error.config?.url,
      status:  error.response?.status,
      message: error.message,
    });
    return Promise.reject(error);
  }
);

module.exports = serviceClient;
