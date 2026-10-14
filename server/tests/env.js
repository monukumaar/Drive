// Runs in every test worker before modules load.
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123';
process.env.BCRYPT_ROUNDS = '4';
process.env.MAX_FILE_SIZE_MB = '1';
process.env.DEFAULT_QUOTA_MB = '10';
process.env.MAX_VERSIONS_PER_FILE = '3';
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-test-'));
