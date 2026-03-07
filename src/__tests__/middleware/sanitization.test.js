// src/__tests__/middleware/sanitization.test.js
'use strict';

require('../setup');

const { sanitizeInput } = require('../../middleware/sanitization');

const makeReq = (overrides = {}) => ({
  body:   {},
  query:  {},
  params: {},
  ...overrides,
});

const mockNext = () => jest.fn();

describe('sanitizeInput middleware', () => {
  it('calls next', () => {
    const req  = makeReq();
    const next = mockNext();
    sanitizeInput(req, {}, next);
    expect(next).toHaveBeenCalled();
  });

  it('strips dollar-sign keys from body (NoSQL injection)', () => {
    const req  = makeReq({ body: { '$gt': '', name: 'Alice' } });
    const next = mockNext();
    sanitizeInput(req, {}, next);
    expect(req.body).not.toHaveProperty('$gt');
    expect(req.body.name).toBe('Alice');
  });

  it('strips dollar-sign keys from query', () => {
    const req  = makeReq({ query: { '$where': '1==1', page: '1' } });
    const next = mockNext();
    sanitizeInput(req, {}, next);
    expect(req.query).not.toHaveProperty('$where');
    expect(req.query.page).toBe('1');
  });

  it('strips angle brackets from string values (XSS)', () => {
    const req  = makeReq({ body: { name: '<script>alert(1)</script>' } });
    const next = mockNext();
    sanitizeInput(req, {}, next);
    expect(req.body.name).not.toContain('<');
    expect(req.body.name).not.toContain('>');
  });

  it('strips javascript: protocol from values', () => {
    const req  = makeReq({ body: { url: 'javascript:alert(1)' } });
    const next = mockNext();
    sanitizeInput(req, {}, next);
    expect(req.body.url).not.toContain('javascript:');
  });

  it('leaves safe values untouched', () => {
    const req  = makeReq({ body: { email: 'user@example.com', age: 30 } });
    const next = mockNext();
    sanitizeInput(req, {}, next);
    expect(req.body.email).toBe('user@example.com');
    expect(req.body.age).toBe(30);
  });
});
