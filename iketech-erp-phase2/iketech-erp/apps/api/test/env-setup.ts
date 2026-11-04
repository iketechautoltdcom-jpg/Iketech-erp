// Runs before any test module is imported, so decorators read these values.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://iketech:iketech_dev@localhost:5432/iketech_test';
process.env.RATE_LIMIT_PER_MIN = '100000';
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.STORAGE_DIR = require('path').join(require('os').tmpdir(), 'iketech-test-storage');
