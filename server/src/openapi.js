// OpenAPI 3.0 description of the API. Served at /api/openapi.json, rendered at /api/docs.
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const json = (schema) => ({ 'application/json': { schema } });
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } };
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
];
const err = (description) => ({ description, content: json(ref('Error')) });
const common = {
  400: err('Validation failed / invalid request'),
  401: err('Missing or invalid token'),
  403: err('Authenticated but lacking the required role'),
  404: err('Not found, or not visible to the caller'),
  409: err('Conflict (duplicate name, concurrent update, ...)'),
};
const pick = (...codes) => Object.fromEntries(codes.map((c) => [c, common[c]]));
const ok = (description, schema) => ({ description, ...(schema ? { content: json(schema) } : {}) });
const secured = [{ bearerAuth: [] }];
const multipart = { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } } } };
const shareOps = (base, tag) => ({
  [`${base}/{id}/shares`]: {
    get: { tags: [tag], summary: 'List shares (owner only)', security: secured, parameters: [idParam], responses: { 200: ok('Shares'), ...pick(401, 403, 404) } },
    post: {
      tags: [tag], summary: 'Share with a registered user, or change their role (owner only)', security: secured, parameters: [idParam],
      requestBody: { required: true, content: json({ type: 'object', required: ['email', 'role'], properties: { email: { type: 'string', format: 'email' }, role: { type: 'string', enum: ['viewer', 'editor'] } } }) },
      responses: { 201: ok('Shared'), ...pick(400, 401, 403, 404) },
    },
  },
  [`${base}/{id}/shares/{userId}`]: {
    delete: {
      tags: [tag], summary: 'Revoke access (owner), or leave a share (the recipient)', security: secured,
      parameters: [idParam, { name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { 204: ok('Revoked'), ...pick(401, 403, 404) },
    },
  },
});

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Drive API',
    version: '1.0.0',
    description: 'Google Drive-like file storage. All errors use `{ "error": { "code", "message", "details?" } }`. ' +
      'Inaccessible and non-existent resources both return 404 so ids cannot be probed.',
  },
  servers: [{ url: '/api' }],
  tags: [{ name: 'Auth' }, { name: 'Folders' }, { name: 'Files' }, { name: 'Versions' }, { name: 'Sharing' }, { name: 'Trash' }, { name: 'Misc' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } } },
      User: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' }, quotaBytes: { type: 'integer' }, storageUsed: { type: 'integer' } } },
      AuthResult: { type: 'object', properties: { user: ref('User'), token: { type: 'string' } } },
      File: { type: 'object', properties: { kind: { type: 'string', enum: ['file'] }, id: { type: 'string' }, name: { type: 'string' }, parentId: { type: 'string', nullable: true }, ownerId: { type: 'string' }, size: { type: 'integer' }, mimeType: { type: 'string' }, currentVersion: { type: 'integer' }, role: { type: 'string', enum: ['viewer', 'editor', 'owner'] }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      Folder: { type: 'object', properties: { kind: { type: 'string', enum: ['folder'] }, id: { type: 'string' }, name: { type: 'string' }, parentId: { type: 'string', nullable: true }, ownerId: { type: 'string' }, role: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      Pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' }, folderCount: { type: 'integer' }, fileCount: { type: 'integer' } } },
      Listing: { type: 'object', properties: { folder: { allOf: [ref('Folder')], nullable: true }, breadcrumbs: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } } }, items: { type: 'array', items: { oneOf: [ref('Folder'), ref('File')] } }, pagination: ref('Pagination') } },
    },
  },
  paths: {
    '/auth/register': { post: { tags: ['Auth'], summary: 'Create an account', requestBody: { required: true, content: json({ type: 'object', required: ['email', 'name', 'password'], properties: { email: { type: 'string' }, name: { type: 'string' }, password: { type: 'string', minLength: 8 } } }) }, responses: { 201: ok('Created', ref('AuthResult')), 400: common[400], 409: common[409] } } },
    '/auth/login': { post: { tags: ['Auth'], summary: 'Log in', requestBody: { required: true, content: json({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }) }, responses: { 200: ok('Logged in', ref('AuthResult')), 400: common[400], 401: common[401] } } },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Current user and storage usage', security: secured, responses: { 200: ok('User'), 401: common[401] } } },

    '/folders': { post: { tags: ['Folders'], summary: 'Create a folder', security: secured, requestBody: { required: true, content: json({ type: 'object', required: ['name'], properties: { name: { type: 'string' }, parentId: { type: 'string', nullable: true } } }) }, responses: { 201: ok('Created', ref('Folder')), ...pick(400, 401, 403, 404, 409) } } },
    '/folders/root/items': { get: { tags: ['Folders'], summary: 'List the caller\'s root (paginated; folders first)', security: secured, parameters: pageParams, responses: { 200: ok('Listing', ref('Listing')), ...pick(400, 401) } } },
    '/folders/{id}': {
      get: { tags: ['Folders'], summary: 'Folder metadata and breadcrumbs', security: secured, parameters: [idParam], responses: { 200: ok('Folder', ref('Folder')), ...pick(401, 404) } },
      patch: { tags: ['Folders'], summary: 'Rename and/or move (parentId null = root)', security: secured, parameters: [idParam], requestBody: { required: true, content: json({ type: 'object', properties: { name: { type: 'string' }, parentId: { type: 'string', nullable: true } } }) }, responses: { 200: ok('Updated', ref('Folder')), ...pick(400, 401, 403, 404, 409) } },
      delete: { tags: ['Folders'], summary: 'Move folder and contents to trash', security: secured, parameters: [idParam], responses: { 204: ok('Trashed'), ...pick(401, 403, 404) } },
    },
    '/folders/{id}/items': { get: { tags: ['Folders'], summary: 'List folder contents (paginated; folders first)', security: secured, parameters: [idParam, ...pageParams], responses: { 200: ok('Listing', ref('Listing')), ...pick(400, 401, 404) } } },
    '/folders/{id}/restore': { post: { tags: ['Trash'], summary: 'Restore a trashed folder with its contents (owner only)', security: secured, parameters: [idParam], responses: { 200: ok('Restored', ref('Folder')), ...pick(401, 404, 409) } } },

    '/files': { post: { tags: ['Files'], summary: 'Upload a new file (multipart, field "file")', description: 'Returns 409 DUPLICATE_NAME if the name is taken; 413 if over the size limit; 507 if over quota.', security: secured, parameters: [{ name: 'folderId', in: 'query', schema: { type: 'string' } }, { name: 'name', in: 'query', description: 'Override the uploaded filename', schema: { type: 'string' } }], requestBody: multipart, responses: { 201: ok('Created', ref('File')), 413: err('File too large'), 507: err('Quota exceeded'), ...pick(400, 401, 403, 404, 409) } } },
    '/files/{id}': {
      get: { tags: ['Files'], summary: 'File metadata', security: secured, parameters: [idParam], responses: { 200: ok('File', ref('File')), ...pick(401, 404) } },
      patch: { tags: ['Files'], summary: 'Rename and/or move', security: secured, parameters: [idParam], requestBody: { required: true, content: json({ type: 'object', properties: { name: { type: 'string' }, parentId: { type: 'string', nullable: true } } }) }, responses: { 200: ok('Updated', ref('File')), ...pick(400, 401, 403, 404, 409) } },
      delete: { tags: ['Files'], summary: 'Move to trash', security: secured, parameters: [idParam], responses: { 204: ok('Trashed'), ...pick(401, 403, 404) } },
    },
    '/files/{id}/download': { get: { tags: ['Files'], summary: 'Download current (or ?version=N) content as an attachment', security: secured, parameters: [idParam, { name: 'version', in: 'query', schema: { type: 'integer' } }], responses: { 200: ok('Binary content'), 410: err('Blob missing from storage'), ...pick(401, 404) } } },
    '/files/{id}/content': { put: { tags: ['Versions'], summary: 'Upload new content as a new version', description: 'Optional `If-Match: <current version>` header gives optimistic concurrency (412 on mismatch).', security: secured, parameters: [idParam, { name: 'If-Match', in: 'header', schema: { type: 'integer' } }], requestBody: multipart, responses: { 200: ok('Updated', ref('File')), 412: err('Version mismatch'), 413: err('File too large'), 507: err('Quota exceeded'), ...pick(400, 401, 403, 404, 409) } } },
    '/files/{id}/versions': { get: { tags: ['Versions'], summary: 'List versions (newest first)', security: secured, parameters: [idParam], responses: { 200: ok('Versions'), ...pick(401, 404) } } },
    '/files/{id}/versions/{number}/restore': { post: { tags: ['Versions'], summary: 'Restore an older version (creates a new version)', security: secured, parameters: [idParam, { name: 'number', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: ok('Restored', ref('File')), 410: err('Blob missing'), 507: err('Quota exceeded'), ...pick(400, 401, 403, 404, 409) } } },
    '/files/{id}/restore': { post: { tags: ['Trash'], summary: 'Restore a trashed file (owner only)', security: secured, parameters: [idParam], responses: { 200: ok('Restored', ref('File')), ...pick(401, 404, 409) } } },
    '/files/{id}/link': {
      post: { tags: ['Sharing'], summary: 'Create (or replace) a public download link (owner only)', security: secured, parameters: [idParam], requestBody: { content: json({ type: 'object', properties: { expiresInHours: { type: 'number' }, maxDownloads: { type: 'integer' } } }) }, responses: { 201: ok('Link; the token is shown only once'), ...pick(400, 401, 403, 404) } },
      delete: { tags: ['Sharing'], summary: 'Revoke the public link (owner only)', security: secured, parameters: [idParam], responses: { 204: ok('Revoked'), ...pick(401, 403, 404) } },
    },
    '/public/{token}': { get: { tags: ['Sharing'], summary: 'Download via public link (no auth)', parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: ok('Binary content'), 404: err('Invalid, expired or exhausted link') } } },
    ...shareOps('/files', 'Sharing'),
    ...shareOps('/folders', 'Sharing'),

    '/shared-with-me': { get: { tags: ['Sharing'], summary: 'Items shared directly with the caller', security: secured, parameters: pageParams, responses: { 200: ok('Items'), ...pick(400, 401) } } },
    '/trash': {
      get: { tags: ['Trash'], summary: 'List trashed items (top-level only)', security: secured, parameters: pageParams, responses: { 200: ok('Items'), ...pick(400, 401) } },
      delete: { tags: ['Trash'], summary: 'Permanently delete everything in the trash', security: secured, responses: { 200: ok('{ purged: n }'), 401: common[401] } },
    },
    '/trash/files/{id}': { delete: { tags: ['Trash'], summary: 'Permanently delete a trashed file', security: secured, parameters: [idParam], responses: { 204: ok('Deleted'), ...pick(401, 404, 409) } } },
    '/trash/folders/{id}': { delete: { tags: ['Trash'], summary: 'Permanently delete a trashed folder tree', security: secured, parameters: [idParam], responses: { 204: ok('Deleted'), ...pick(401, 404, 409) } } },
    '/audit': { get: { tags: ['Misc'], summary: 'Audit log for resources the caller owns', security: secured, parameters: pageParams, responses: { 200: ok('Events'), ...pick(400, 401) } } },
    '/health': { get: { tags: ['Misc'], summary: 'Liveness probe', responses: { 200: ok('OK') } } },
  },
};
