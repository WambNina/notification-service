const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Notification Service API',
      version: '1.0.0',
      description: 'Simple notification service with email, MySQL, and image attachments',
    },
    // servers: [
    //   {
    //     url: 'http://localhost:3004',
    //     description: 'Local development server',
    //   },
    // ],
  },
  // Use absolute path based on this file's location
  apis: [path.join(__dirname, '../routes/*.js')],
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = swaggerSpec;