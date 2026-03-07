// src/middleware/timeout.middleware.js
'use strict';

/**
 * Per-request timeout middleware.
 * Sends a 503 if the request handler has not called res.end() within the
 * configured window. This prevents hung requests from holding connections.
 *
 * @param {number} ms - Timeout in milliseconds (default: 30 000)
 */
const requestTimeout = (ms = 30_000) => (req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({
        success:    false,
        statusCode: 503,
        message:    'The server took too long to process your request. Please try again.',
        error:      { code: 'REQUEST_TIMEOUT' },
      });
    }
  }, ms);

  // Clean up on response finish to avoid memory leaks
  res.on('finish', () => clearTimeout(timer));
  res.on('close',  () => clearTimeout(timer));

  next();
};

module.exports = { requestTimeout };
