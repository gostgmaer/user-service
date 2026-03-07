// src/__tests__/routes/health.test.js
'use strict';

require('../setup');

const request = require('supertest');

// Mock database and redis before app loads
jest.mock('../../config/db', () => ({
  connectDB:    jest.fn().mockResolvedValue(true),
  disconnectDB: jest.fn().mockResolvedValue(true),
  isConnected:  jest.fn().mockReturnValue(true),
}));

jest.mock('../../config/redis', () => ({
  getRedisClient: jest.fn().mockReturnValue(null),
  isRedisReady:   jest.fn().mockReturnValue(false),
}));

const app = require('../../../app');

describe('Health Routes', () => {
  describe('GET /health/live', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('user-service');
    });
  });

  describe('GET /health/ready', () => {
    it('returns 200 when DB is connected', async () => {
      const { isConnected } = require('../../config/db');
      isConnected.mockReturnValue(true);
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
      expect(res.body.db).toBe('ok');
    });

    it('returns 503 when DB is not connected', async () => {
      const { isConnected } = require('../../config/db');
      isConnected.mockReturnValue(false);
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.db).toBe('unavailable');
    });
  });

  describe('GET /health', () => {
    it('returns 200 with full metrics when DB is up', async () => {
      const { isConnected } = require('../../config/db');
      isConnected.mockReturnValue(true);
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('version');
      expect(res.body).toHaveProperty('uptime');
      expect(res.body).toHaveProperty('memory');
      expect(res.body.dependencies).toHaveProperty('db', 'ok');
    });

    it('returns 503 with degraded status when DB is down', async () => {
      const { isConnected } = require('../../config/db');
      isConnected.mockReturnValue(false);
      const res = await request(app).get('/health');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
    });
  });
});
