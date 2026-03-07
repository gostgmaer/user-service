// jest.config.js
'use strict';

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment:  'node',
  testMatch:        ['**/__tests__/**/*.test.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/__tests__/**',
    '!src/config/swagger.js',
  ],
  coverageThreshold: {
    global: {
      branches:   60,
      functions:  60,
      lines:      60,
      statements: 60,
    },
  },
  testTimeout:  15000,
  clearMocks:   true,
  resetMocks:   false,
  restoreMocks: false,
  // Suppress console output during tests
  silent: false,
  // Setup env vars before modules load
  setupFiles: ['./src/__tests__/setup.js'],
  moduleNameMapper: {},
  // Ignore node_modules and coverage output
  testPathIgnorePatterns: ['/node_modules/', '/coverage/'],
};
