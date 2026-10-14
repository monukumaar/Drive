const { ZodError } = require('zod');
const multer = require('multer');
const { AppError } = require('../utils/errors');

const body = (code, message, details) => ({ error: { code, message, ...(details ? { details } : {}) } });

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, next) => {
  if (err instanceof AppError) return res.status(err.status).json(body(err.code, err.message, err.details));
  if (err instanceof ZodError) {
    const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return res.status(400).json(body('VALIDATION_ERROR', 'Request validation failed', details));
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json(body('FILE_TOO_LARGE', 'File exceeds the maximum upload size'));
    return res.status(400).json(body('UPLOAD_ERROR', err.message));
  }
  if (err.code === 11000) return res.status(409).json(body('DUPLICATE_NAME', 'An item with that name already exists here'));
  if (err.type === 'entity.parse.failed') return res.status(400).json(body('INVALID_JSON', 'Malformed JSON body'));
  if (err.name === 'CastError') return res.status(400).json(body('INVALID_ID', 'Invalid identifier'));
  console.error(err);
  return res.status(500).json(body('INTERNAL_ERROR', 'Something went wrong'));
};
