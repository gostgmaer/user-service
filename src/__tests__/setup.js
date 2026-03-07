// src/__tests__/setup.js
'use strict';

// Set test environment variables BEFORE any module loads the env config
process.env.NODE_ENV             = 'test';
process.env.PORT                 = '3501';
process.env.MONGO_URI            = 'mongodb://localhost:27017/user-service-test';
process.env.JWT_ACCESS_SECRET    = 'test_access_secret_at_least_32_chars_long_!';
process.env.JWT_REFRESH_SECRET   = 'test_refresh_secret_at_least_32_chars_long!';
process.env.JWT_ID_SECRET        = 'test_id_secret_that_is_at_least_32_chars!!!!';
process.env.JWT_ISSUER           = 'test-issuer';
process.env.JWT_AUDIENCE         = 'test-audience';
process.env.CORS_ORIGIN          = 'http://localhost:3000';
process.env.SERVICE_API_KEY      = 'test-service-key';
process.env.ALLOWED_SERVICE_API_KEYS = 'test-allowed-key';
process.env.BCRYPT_ROUNDS        = '10';
process.env.LOG_LEVEL            = 'error';   // suppress logs in tests
process.env.LOG_FORMAT           = 'json';
