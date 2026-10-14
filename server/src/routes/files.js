const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { pipeline } = require('stream');
const { File, Version, User } = require('../models');
const access = require('../services/access');
const fileService = require('../services/fileService');
const trash = require('../services/trashService');
const { audit } = require('../services/audit');
const storage = require('../storage');
const config = require('../config');
const { validate, objectId, z } = require('../middleware/validate');
const { cleanName, baseName } = require('../utils/names');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, forbidden, conflict, notFound, gone } = require('../utils/errors');
const sharesRouter = require('./shares');

const { loadItem, assertNameFree, fileDTO } = access;
const router = express.Router();
const idParam = { id: objectId };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, storage.tmpDir),
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: config.maxFileBytes, files: 1 },
});

/** If-Match: <version number> enables optimistic concurrency on writes. */
function expectedVersion(req) {
  const raw = req.get('If-Match');
  if (!raw) return null;
  const n = Number(raw.replace(/"/g, ''));
  if (!Number.isInteger(n) || n < 1) throw badRequest('If-Match must be a version number', 'INVALID_IF_MATCH');
  return n;
}

/** Stream one stored version to the client as an attachment. */
async function sendVersion(res, file, version) {
  try {
    await storage.stat(version.storageKey);
  } catch (e) {
    if (e.code === 'ENOENT') throw gone('File content is missing from storage', 'BLOB_MISSING');
    throw e;
  }
  res.attachment(file.name); // sets Content-Disposition (RFC 6266 encoded) -- never inline
  res.setHeader('Content-Type', version.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', version.size);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('ETag', `"${version.number}"`);
  pipeline(storage.stream(version.storageKey), res, (err) => {
    if (err && !res.headersSent) res.status(500).end();
  });
}

// ---- Upload (new file) ------------------------------------------------------
// folderId/name travel in the query string so permissions can be checked
// *before* the request body is read.
router.post('/', validate({ query: { folderId: objectId.optional(), name: z.string().optional() } }),
  asyncHandler(async (req, res, next) => {
    req.targetFolder = null;
    if (req.valid.query.folderId) ({ item: req.targetFolder } = await loadItem('folder', req.valid.query.folderId, req.user, 'editor'));
    next();
  }),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const f = req.file;
    try {
      if (!f) throw badRequest('Send the file as multipart/form-data in the "file" field', 'NO_FILE');
      const name = cleanName(req.valid.query.name !== undefined ? req.valid.query.name : baseName(f.originalname));
      const parent = req.targetFolder;
      const ownerId = parent ? parent.owner : req.user._id;
      await assertNameFree(ownerId, parent && parent._id, name);
      const file = await fileService.createFile({
        ownerId, parentId: parent && parent._id, name, mimeType: f.mimetype || 'application/octet-stream',
        tmpPath: f.path, size: f.size, actorId: req.user._id,
      });
      audit(req, { action: 'file.upload', targetType: 'file', targetId: file._id, owner: ownerId, meta: { size: f.size } });
      res.status(201).json(fileDTO(file));
    } finally {
      await storage.discard(f && f.path);
    }
  }));

// ---- Read -------------------------------------------------------------------
router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { item, role } = await loadItem('file', req.valid.params.id, req.user, 'viewer');
  res.json(fileDTO(item, role));
}));

router.get('/:id/download', validate({ params: idParam, query: { version: z.coerce.number().int().min(1).optional() } }),
  asyncHandler(async (req, res) => {
    const { item } = await loadItem('file', req.valid.params.id, req.user, 'viewer');
    const number = req.valid.query.version || item.currentVersion;
    const version = await Version.findOne({ file: item._id, number });
    if (!version) throw notFound('Version not found');
    audit(req, { action: 'file.download', targetType: 'file', targetId: item._id, owner: item.owner, meta: { version: number } });
    await sendVersion(res, item, version);
  }));

// ---- Replace content => new version -----------------------------------------
router.put('/:id/content', validate({ params: idParam }),
  asyncHandler(async (req, res, next) => {
    ({ item: req.fileDoc } = await loadItem('file', req.valid.params.id, req.user, 'editor'));
    req.expected = expectedVersion(req);
    next();
  }),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const f = req.file;
    try {
      if (!f) throw badRequest('Send the file as multipart/form-data in the "file" field', 'NO_FILE');
      const file = await fileService.addVersion({
        file: req.fileDoc, actorId: req.user._id, expectedVersion: req.expected,
        source: { tmpPath: f.path, size: f.size, mimeType: f.mimetype || 'application/octet-stream' },
      });
      audit(req, { action: 'file.version.create', targetType: 'file', targetId: file._id, owner: file.owner, meta: { version: file.currentVersion } });
      res.json(fileDTO(file));
    } finally {
      await storage.discard(f && f.path);
    }
  }));

// ---- Rename / move ----------------------------------------------------------
router.patch('/:id', validate({
  params: idParam,
  body: { name: z.string().optional(), parentId: objectId.nullable().optional() },
}), asyncHandler(async (req, res) => {
  const { item: file, role } = await loadItem('file', req.valid.params.id, req.user, 'editor');
  const { name: rawName, parentId } = req.valid.body;
  if (rawName === undefined && parentId === undefined) throw badRequest('Provide name and/or parentId');

  const name = rawName === undefined ? file.name : cleanName(rawName);
  let destId = file.parent;
  if (parentId !== undefined) {
    if (parentId === null) {
      if (role !== 'owner') throw forbidden('Only the owner can move an item to the root');
      destId = null;
    } else {
      const { item: dest } = await loadItem('folder', parentId, req.user, 'editor');
      if (String(dest.owner) !== String(file.owner)) throw forbidden('Items cannot be moved between different owners');
      destId = dest._id;
    }
  }
  const moving = String(destId || '') !== String(file.parent || '');
  if (moving || name !== file.name) await assertNameFree(file.owner, destId, name, file._id);
  await File.updateOne({ _id: file._id }, { $set: { name, parent: destId } });
  audit(req, { action: moving ? 'file.move' : 'file.rename', targetType: 'file', targetId: file._id, owner: file.owner, meta: { name, parentId: destId } });
  res.json(fileDTO(await File.findById(file._id), role));
}));

// ---- Trash ------------------------------------------------------------------
router.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { item } = await loadItem('file', req.valid.params.id, req.user, 'editor');
  await trash.trashFile(item);
  audit(req, { action: 'file.trash', targetType: 'file', targetId: item._id, owner: item.owner });
  res.status(204).end();
}));

router.post('/:id/restore', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { item } = await loadItem('file', req.valid.params.id, req.user, 'owner', { allowTrashed: true });
  if (!item.trashed) throw conflict('File is not in the trash', 'NOT_TRASHED');
  await trash.restoreFile(item);
  audit(req, { action: 'file.restore', targetType: 'file', targetId: item._id, owner: item.owner });
  res.json(fileDTO(await File.findById(item._id), 'owner'));
}));

// ---- Versions ---------------------------------------------------------------
router.get('/:id/versions', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { item } = await loadItem('file', req.valid.params.id, req.user, 'viewer');
  const versions = await Version.find({ file: item._id }).sort({ number: -1 });
  const authors = await User.find({ _id: { $in: versions.map((v) => v.createdBy) } }).select('name email');
  const byId = new Map(authors.map((u) => [String(u._id), u]));
  res.json({
    versions: versions.map((v) => ({
      number: v.number, size: v.size, mimeType: v.mimeType, sha256: v.sha256, createdAt: v.createdAt,
      createdBy: byId.get(String(v.createdBy)) ? { id: v.createdBy, name: byId.get(String(v.createdBy)).name } : null,
      isCurrent: v.number === item.currentVersion,
    })),
  });
}));

// Restoring never rewrites history: it appends a copy of the old content as the newest version.
router.post('/:id/versions/:number/restore', validate({ params: { ...idParam, number: z.coerce.number().int().min(1) } }),
  asyncHandler(async (req, res) => {
    const { item } = await loadItem('file', req.valid.params.id, req.user, 'editor');
    const old = await Version.findOne({ file: item._id, number: req.valid.params.number });
    if (!old) throw notFound('Version not found');
    if (old.number === item.currentVersion) throw badRequest('That version is already the current one', 'ALREADY_CURRENT');
    try {
      await storage.stat(old.storageKey);
    } catch (e) {
      if (e.code === 'ENOENT') throw gone('Stored content for that version is missing', 'BLOB_MISSING');
      throw e;
    }
    const file = await fileService.addVersion({
      file: item, actorId: req.user._id, expectedVersion: expectedVersion(req),
      source: { copyFromKey: old.storageKey, size: old.size, mimeType: old.mimeType, sha256: old.sha256 },
    });
    audit(req, { action: 'file.version.restore', targetType: 'file', targetId: file._id, owner: file.owner, meta: { restoredFrom: old.number, version: file.currentVersion } });
    res.json(fileDTO(file));
  }));

// ---- Public link (owner only) -----------------------------------------------
router.post('/:id/link', validate({
  params: idParam,
  body: {
    expiresInHours: z.number().positive().max(24 * 365).optional(),
    maxDownloads: z.number().int().positive().optional(),
  },
}), asyncHandler(async (req, res) => {
  const { item } = await loadItem('file', req.valid.params.id, req.user, 'owner');
  const { expiresInHours, maxDownloads } = req.valid.body;
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = expiresInHours ? new Date(Date.now() + expiresInHours * 3600 * 1000) : null;
  await File.updateOne({ _id: item._id }, {
    $set: {
      link: { tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiresAt, maxDownloads: maxDownloads || null, downloads: 0, createdAt: new Date() },
    },
  });
  audit(req, { action: 'link.create', targetType: 'file', targetId: item._id, owner: item.owner, meta: { expiresAt, maxDownloads } });
  // The token is only returned now; we keep just its hash.
  res.status(201).json({ token, url: `/api/public/${token}`, expiresAt, maxDownloads: maxDownloads || null });
}));

router.delete('/:id/link', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { item } = await loadItem('file', req.valid.params.id, req.user, 'owner');
  await File.updateOne({ _id: item._id }, { $unset: { 'link.tokenHash': 1 }, $set: { 'link.expiresAt': null, 'link.maxDownloads': null, 'link.downloads': 0 } });
  audit(req, { action: 'link.delete', targetType: 'file', targetId: item._id, owner: item.owner });
  res.status(204).end();
}));

router.use('/:id/shares', sharesRouter('file'));

module.exports = router;
module.exports.sendVersion = sendVersion;
