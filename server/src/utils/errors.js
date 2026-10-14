class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = {
  AppError,
  badRequest: (message, code = 'BAD_REQUEST', details) => new AppError(400, code, message, details),
  unauthorized: (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to do that') => new AppError(403, 'FORBIDDEN', message),
  notFound: (message = 'Not found') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message, code = 'CONFLICT') => new AppError(409, code, message),
  gone: (message, code = 'GONE') => new AppError(410, code, message),
  preconditionFailed: (message) => new AppError(412, 'VERSION_MISMATCH', message),
};
