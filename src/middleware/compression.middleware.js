// src/middleware/compression.middleware.js
'use strict';

const _compression = require('compression');

// Compress responses larger than 1 KB
module.exports = _compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return _compression.filter(req, res);
  },
});
