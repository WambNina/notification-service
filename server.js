require('dotenv').config();
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./docs/swagger');
const messageRoutes = require('./routes/messageRoutes');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} | ${req.method} ${req.path}`);
  next();
});

// ==========================================
// Swagger Docs - Redirect /api-docs → /api-docs/
// ==========================================
app.get('/api-docs', (req, res) => {
  res.redirect('/api-docs/');
});

app.use('/api-docs/', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customSiteTitle: 'Notification Service API'
}));

// API Routes
app.use('/api', messageRoutes);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'UP', service: 'notification-service', timestamp: new Date().toISOString() });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Global Error:', err.stack);
  res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📚 Swagger Docs at http://localhost:${PORT}/api-docs/`);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📚 Swagger Docs at http://localhost:${PORT}/api-docs/`);
  });
}

// Export for Vercel serverless
module.exports = app;