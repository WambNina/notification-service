const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const PORT = process.env.PORT || 3004;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Notification Service API',
      version: '1.0.0',
      description: 'Simple notification service with email, Supabase, and image attachments',
    },
    servers: [
      {
        url: PUBLIC_URL,
        description: 'Current environment server',
      },
    ],
  },
  apis: [path.join(__dirname, '../routes/*.js')],
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = swaggerSpec;