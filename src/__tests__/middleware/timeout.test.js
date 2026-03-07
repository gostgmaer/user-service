// src/__tests__/middleware/timeout.test.js
'use strict';

require('../setup');

const { requestTimeout } = require('../../middleware/timeout.middleware');

const mockReqResNext = () => {
  const events = {};
  const res = {
    headersSent: false,
    on: (event, cb) => { events[event] = cb; },
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockReturnThis(),
    _emit:  (event) => events[event] && events[event](),
  };
  const req  = {};
  const next = jest.fn();
  return { req, res, next, events };
};

describe('requestTimeout middleware', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('calls next immediately', () => {
    const { req, res, next } = mockReqResNext();
    requestTimeout(5000)(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sends 503 after timeout if headers not sent', () => {
    const { req, res, next } = mockReqResNext();
    requestTimeout(5000)(req, res, next);
    jest.advanceTimersByTime(6000);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error:   'REQUEST_TIMEOUT',
      success: false,
    }));
  });

  it('does NOT send 503 if headers were already sent', () => {
    const { req, res, next } = mockReqResNext();
    res.headersSent = true;
    requestTimeout(5000)(req, res, next);
    jest.advanceTimersByTime(6000);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('clears timer on response finish', () => {
    const { req, res, next } = mockReqResNext();
    requestTimeout(5000)(req, res, next);
    res._emit('finish');
    jest.advanceTimersByTime(6000);
    // Timer was cleared — no 503 should be sent
    expect(res.status).not.toHaveBeenCalled();
  });
});
