const { badRequest } = require('./errors');

/**
 * Validate a user-supplied file/folder name. Names are only ever stored as
 * metadata (blobs live under server-generated keys), but we still reject
 * anything that could be misused by a client that writes the name to disk.
 */
function cleanName(raw) {
  if (typeof raw !== 'string') throw badRequest('Name must be a string', 'INVALID_NAME');
  const name = raw.normalize('NFC').trim();
  if (!name) throw badRequest('Name must not be empty', 'INVALID_NAME');
  if (name.length > 255) throw badRequest('Name must be at most 255 characters', 'INVALID_NAME');
  if (name === '.' || name === '..') throw badRequest('Invalid name', 'INVALID_NAME');
  if (/[\/\\\u0000-\u001f\u007f]/.test(name)) {
    throw badRequest('Name must not contain slashes or control characters', 'INVALID_NAME');
  }
  return name;
}

/** Strip any directory components a client may have put into a filename. */
function baseName(raw) {
  return String(raw || '').split(/[\\/]/).pop();
}

module.exports = { cleanName, baseName };
