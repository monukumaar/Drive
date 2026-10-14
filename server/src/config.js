const path = require('path');
require('dotenv').config();

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const env = process.env.NODE_ENV || 'development';

if (env !== 'test' && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET must be set to a random string of at least 32 characters');
}

const MB = 1024 * 1024;

module.exports = {
  env,
  port: num(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/drive',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  bcryptRounds: num(process.env.BCRYPT_ROUNDS, 12),
  storageDir: path.resolve(process.env.STORAGE_DIR || './storage'),
  defaultQuotaBytes: Math.floor(num(process.env.DEFAULT_QUOTA_MB, 100) * MB),
  maxFileBytes: Math.floor(num(process.env.MAX_FILE_SIZE_MB, 50) * MB),
  maxVersionsPerFile: num(process.env.MAX_VERSIONS_PER_FILE, 20),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  authRateLimitPerMin: num(process.env.AUTH_RATE_LIMIT_PER_MIN, 30),
};
