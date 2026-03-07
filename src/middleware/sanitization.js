// src/middleware/sanitization.js
// XSS + NoSQL injection sanitization.
// Compatible with Express 5 (req.query is a read-only getter — mutate in place).
'use strict';

const sanitizeString = (input) => {
  if (typeof input !== 'string') return input;
  return input
    .trim()
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
};

const removeMongoOperators = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (Array.isArray(obj))     return obj.map(removeMongoOperators);
  if (typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      if (key.startsWith('$') || key.includes('.')) return acc;
      acc[key] = removeMongoOperators(obj[key]);
      return acc;
    }, {});
  }
  return obj;
};

const sanitizeObject = (obj) => {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeString(obj);
  if (Array.isArray(obj))     return obj.map(sanitizeObject);
  if (typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, sanitizeObject(v)]));
  }
  return obj;
};

/**
 * Mutate an object's keys/values in-place after sanitising.
 * Used for req.query / req.params which are read-only in Express 5.
 */
const sanitizeInPlace = (target) => {
  const cleaned = removeMongoOperators(sanitizeObject(target));
  // Remove keys that were stripped by removeMongoOperators
  Object.keys(target).forEach((k) => {
    if (!(k in cleaned)) delete target[k];
  });
  // Update values in-place
  Object.assign(target, cleaned);
};

const sanitizeInput = (req, _res, next) => {
  try {
    // body can be reassigned in Express 5
    if (req.body && typeof req.body === 'object') {
      req.body = removeMongoOperators(sanitizeObject(req.body));
    }
    // query and params are read-only getters in Express 5 — mutate in place
    if (req.query  && typeof req.query  === 'object') sanitizeInPlace(req.query);
    if (req.params && typeof req.params === 'object') sanitizeInPlace(req.params);
  } catch (_err) {
    // Non-fatal — proceed even if sanitization partially fails
  }
  next();
};

module.exports = { sanitizeInput };
