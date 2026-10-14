const express = require('express');
const { File, Folder, AuditLog } = require('../models');
const { folderDTO, fileDTO, loadItem } = require('../services/access');
const trash = require('../services/trashService');
const { audit } = require('../services/audit');
const { validate, objectId } = require('../middleware/validate');
const { pageQuery, paginateFoldersAndFiles } = require('../utils/pagination');
const asyncHandler = require('../utils/asyncHandler');
const { conflict } = require('../utils/errors');

const router = express.Router();
const toItems = ({ folders, files }) => [...folders.map((f) => folderDTO(f)), ...files.map((f) => fileDTO(f))];

// Items other users shared directly with me (their subtrees are reachable through them).
router.get('/shared-with-me', validate({ query: pageQuery }), asyncHandler(async (req, res) => {
  const filter = { 'shares.user': req.user._id, trashed: false };
  const result = await paginateFoldersAndFiles(Folder, File, filter, filter, req.valid.query);
  res.json({ items: toItems(result), pagination: result.pagination });
}));

router.get('/trash', validate({ query: pageQuery }), asyncHandler(async (req, res) => {
  const filter = trash.trashRoots(req.user._id);
  const result = await paginateFoldersAndFiles(Folder, File, filter, filter, req.valid.query);
  res.json({ items: toItems(result), pagination: result.pagination });
}));

router.delete('/trash', asyncHandler(async (req, res) => {
  const purged = await trash.emptyTrash(req.user._id);
  res.json({ purged });
}));

// Permanent deletion: owner only, and only for items already in the trash.
for (const [segment, kind, purge] of [['files', 'file', trash.purgeFile], ['folders', 'folder', trash.purgeFolder]]) {
  router.delete(`/trash/${segment}/:id`, validate({ params: { id: objectId } }), asyncHandler(async (req, res) => {
    const { item } = await loadItem(kind, req.valid.params.id, req.user, 'owner', { allowTrashed: true });
    if (!item.trashed) throw conflict('Item is not in the trash', 'NOT_TRASHED');
    await purge(item);
    audit(req, { action: `${kind}.purge`, targetType: kind, targetId: item._id, owner: item.owner });
    res.status(204).end();
  }));
}

// Activity on resources I own (including actions by people I shared with).
router.get('/audit', validate({ query: pageQuery }), asyncHandler(async (req, res) => {
  const { page, limit } = req.valid.query;
  const filter = { owner: req.user._id };
  const [total, events] = await Promise.all([
    AuditLog.countDocuments(filter),
    AuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).populate('actor', 'name email'),
  ]);
  res.json({
    events: events.map((e) => ({
      id: e._id, action: e.action, targetType: e.targetType, targetId: e.targetId, meta: e.meta, createdAt: e.createdAt,
      actor: e.actor ? { id: e.actor._id, name: e.actor.name, email: e.actor.email } : null,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
}));

module.exports = router;
