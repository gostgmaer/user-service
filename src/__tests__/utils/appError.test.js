// src/__tests__/utils/appError.test.js
'use strict';

require('../setup');

const AppError = require('../../utils/appError');

describe('AppError', () => {
  describe('constructor', () => {
    it('creates an operational error with correct properties', () => {
      const err = new AppError(404, 'Not found');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(AppError);
      expect(err.message).toBe('Not found');
      expect(err.statusCode).toBe(404);
      expect(err.isOperational).toBe(true);
      expect(err.status).toBe('fail');
    });

    it('sets status to "error" for 5xx codes', () => {
      const err = new AppError(500, 'Internal');
      expect(err.status).toBe('error');
    });

    it('sets status to "fail" for 4xx codes', () => {
      const err = new AppError(400, 'Bad request');
      expect(err.status).toBe('fail');
    });

    it('captures a stack trace', () => {
      const err = new AppError(400, 'test');
      expect(err.stack).toBeTruthy();
    });

    it('accepts a custom error code', () => {
      const err = new AppError(400, 'bad', 'MY_CODE');
      expect(err.code).toBe('MY_CODE');
    });

    it('attaches details when provided', () => {
      const details = { field: 'email' };
      const err = new AppError(422, 'Invalid', null, details);
      expect(err.details).toEqual(details);
    });
  });

  describe('static factory methods', () => {
    it('notFound creates a 404 error', () => {
      const err = AppError.notFound('Resource missing');
      expect(err.statusCode).toBe(404);
      expect(err.message).toBe('Resource missing');
      expect(err.code).toBe('NOT_FOUND');
    });

    it('notFound uses default message', () => {
      const err = AppError.notFound();
      expect(err.message).toBe('Resource not found');
    });

    it('badRequest creates a 400 error', () => {
      const err = AppError.badRequest('Bad input');
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('BAD_REQUEST');
    });

    it('unauthorized creates a 401 error', () => {
      const err = AppError.unauthorized();
      expect(err.statusCode).toBe(401);
    });

    it('forbidden creates a 403 error', () => {
      const err = AppError.forbidden();
      expect(err.statusCode).toBe(403);
    });

    it('conflict creates a 409 error', () => {
      const err = AppError.conflict('Duplicate entry');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('DUPLICATE_ENTRY');
    });

    it('internal creates a 500 error', () => {
      const err = AppError.internal('Server error');
      expect(err.statusCode).toBe(500);
      expect(err.status).toBe('error');
    });

    it('tooManyRequests creates a 429 error', () => {
      const err = AppError.tooManyRequests();
      expect(err.statusCode).toBe(429);
    });

    it('locked creates a 423 error', () => {
      const err = AppError.locked();
      expect(err.statusCode).toBe(423);
    });

    it('validation creates a 400 with validation error code', () => {
      const err = AppError.validation('field required', ['email']);
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.validationErrors).toEqual(['email']);
    });
  });
});
