const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const openapi = require('./openapi');
const errorHandler = require('./middleware/error');
const { authenticate } = require('./middleware/auth');
const { notFound } = require('./utils/errors');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, exposedHeaders: ['Content-Disposition', 'ETag'] }));
  if (config.env !== 'test') app.use(morgan('combined'));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/openapi.json', (req, res) => res.json(openapi));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));

  const authLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: config.authRateLimitPerMin,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => config.env === 'test',
    message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again shortly' } },
  });
  app.use('/api/auth', authLimiter, require('./routes/auth'));
  app.use('/api/public', require('./routes/public'));

  // Everything below requires a valid token.
  app.use('/api', authenticate);
  app.use('/api/folders', require('./routes/folders'));
  app.use('/api/files', require('./routes/files'));
  app.use('/api', require('./routes/library'));

  app.use('/api', (req, res, next) => next(notFound('Route not found')));

  // Optional: serve the built React client (used by the Docker image).
  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
    app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
