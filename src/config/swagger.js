// src/config/swagger.js
'use strict';

const swaggerJsdoc = require('swagger-jsdoc');
const { version }  = require('../../package.json');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'User Service API',
      version,
      description: 'RESTful user management microservice — CRUD, preferences, loyalty, subscriptions, analytics, and admin operations.',
      contact: {
        name: 'Backend Team',
      },
    },
    servers: [
      { url: '/api/users', description: 'User resource root' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
          description:  'JWT access token issued by the auth service.',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in:   'header',
          name: 'x-api-key',
          description: 'Service-to-service API key.',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            _id:          { type: 'string', example: '507f1f77bcf86cd799439011' },
            email:        { type: 'string', format: 'email' },
            firstName:    { type: 'string', example: 'Jane' },
            lastName:     { type: 'string', example: 'Doe' },
            username:     { type: 'string', example: 'jane_doe' },
            phoneNumber:  { type: 'string', example: '+15550001234' },
            role:         { type: 'string', example: '507f1f77bcf86cd799439012' },
            isActive:     { type: 'boolean', default: true },
            isVerified:   { type: 'boolean', default: false },
            status:       { type: 'string', enum: ['active','inactive','pending','banned','suspended'] },
            loyaltyPoints:{ type: 'integer', minimum: 0, example: 120 },
            createdAt:    { type: 'string', format: 'date-time' },
            updatedAt:    { type: 'string', format: 'date-time' },
          },
        },
        PaginatedUsers: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: {
              type: 'object',
              properties: {
                users:    { type: 'array', items: { '$ref': '#/components/schemas/User' } },
                total:    { type: 'integer' },
                page:     { type: 'integer' },
                limit:    { type: 'integer' },
                pages:    { type: 'integer' },
              },
            },
          },
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error:   { type: 'string', example: 'NOT_FOUND' },
            message: { type: 'string', example: 'User not found' },
          },
        },
        ValidationError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Validation failed' },
            errors:  {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field:   { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: 'Users',         description: 'Core user CRUD' },
      { name: 'Auth',          description: 'Authentication sub-routes' },
      { name: 'Profile',       description: 'Profile management' },
      { name: 'Preferences',   description: 'User preferences' },
      { name: 'Addresses',     description: 'Shipping / billing addresses' },
      { name: 'Loyalty',       description: 'Loyalty point operations' },
      { name: 'Subscription',  description: 'Subscription management' },
      { name: 'Social',        description: 'Social account linking' },
      { name: 'Interests',     description: 'Interest / category management' },
      { name: 'Sessions',      description: 'Session & security management' },
      { name: 'Bulk',          description: 'Bulk admin operations' },
      { name: 'Analytics',     description: 'Aggregated analytics & reporting' },
      { name: 'Export/Import', description: 'Data export and import' },
      { name: 'Health',        description: 'Service health & readiness probes' },
    ],
  },
  apis: [
    './src/routes/*.js',
    './src/controller/*.js',
  ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
