// src/__tests__/utils/responseHelper.test.js
'use strict';

require('../setup');

const {
  sendSuccess,
  sendCreated,
  sendError,
  sendPaginated,
  sendNoContent,
} = require('../../utils/responseHelper');

// Minimal mock of Express response
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  res.send   = jest.fn().mockReturnValue(res);
  return res;
};

describe('responseHelper', () => {
  // sendSuccess(res, message, data, statusCode, meta)
  describe('sendSuccess', () => {
    it('sends 200 with success payload', () => {
      const res = mockRes();
      sendSuccess(res, 'ok', { id: 1 });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        message: 'ok',
        data:    { id: 1 },
      }));
    });

    it('accepts a custom status code', () => {
      const res = mockRes();
      sendSuccess(res, 'fine', {}, 202);
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('omits data key when data is null', () => {
      const res = mockRes();
      sendSuccess(res, 'no data');
      const body = res.json.mock.calls[0][0];
      expect(body).not.toHaveProperty('data');
    });

    it('omits pagination field when none given', () => {
      const res  = mockRes();
      sendSuccess(res, 'ok', null, 200);
      const body = res.json.mock.calls[0][0];
      expect(body).not.toHaveProperty('pagination');
      expect(body).not.toHaveProperty('meta');
    });
  });

  // sendCreated(res, message, data)
  describe('sendCreated', () => {
    it('sends 201 with created payload', () => {
      const res = mockRes();
      sendCreated(res, 'Created', { _id: 'abc' });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        data:    { id: 'abc' },
      }));
    });
  });

  // sendError(res, message, statusCode, code, errors)
  describe('sendError', () => {
    it('sends an error response with status and code', () => {
      const res = mockRes();
      sendError(res, 'Something went wrong', 500, 'INTERNAL_ERROR');
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        message: 'Something went wrong',
      }));
    });

    it('defaults to 500 if no statusCode provided', () => {
      const res = mockRes();
      sendError(res, 'boom');
      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('attaches details array when provided', () => {
      const res = mockRes();
      sendError(res, 'Bad', 422, 'VALIDATION_ERROR', ['field required']);
      const body = res.json.mock.calls[0][0];
      expect(body.error.details).toEqual(['field required']);
    });
  });

  // sendPaginated(res, message, data, total, page, limit, extra)
  describe('sendPaginated', () => {
    it('sends a paginated response with pagination at top level', () => {
      const res  = mockRes();
      const data = [{ id: 1 }, { id: 2 }];
      sendPaginated(res, 'Users retrieved', data, 50, 1, 10);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(true);
      expect(body.data).toEqual(data);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.totalRecords).toBe(50);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(10);
      expect(body.pagination.totalPages).toBe(5);
      expect(body.pagination.hasNext).toBe(true);
      expect(body.pagination.hasPrev).toBe(false);
    });
  });

  describe('sendNoContent', () => {
    it('sends 204 with no body', () => {
      const res = mockRes();
      sendNoContent(res);
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalled();
    });
  });
});
