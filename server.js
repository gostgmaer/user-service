// server.js — Entry point
'use strict';

require('./src/config/validateEnv');

const { connectDB, disconnectDB } = require('./src/config/db');
const logger = require('./src/services/logger');
const app    = require('./app');

const PORT = parseInt(process.env.PORT || '3501', 10);

let server;

const start = async () => {
  try {
    await connectDB();
    server = app.listen(PORT, () => {
      logger.info('user-service started', {
        port: PORT,
        env:  process.env.NODE_ENV || 'development',
        pid:  process.pid,
      });
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
};

const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      logger.info('HTTP server closed');
    }
    await disconnectDB();
    logger.info('MongoDB disconnected');
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', { error: err.message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason) });
  process.exit(1);
});

start();
