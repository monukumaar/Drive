const express = require('express');
const { Folder, File } = require('../models');
const access = require('../services/access');
const { reparentFolder } = require('../services/folderService');
const trash = require('../services/trashService');
const { audit } = require('../services/audit');
const { validate, objectId, z } = require('../middleware/validate');
const { pageQuery, paginateFoldersAndFiles } = require('../utils/pagination');
const { cleanName } = require('../utils/names');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, forbidden, conflict } = require('../utils/errors');
const sharesRouter = require('./shares');

const { loadItem, assertNameFree, folderDTO, fileDTO } = access;
const router = express.Router();
const idParam = { id: objectId };

router.post('/', validate({ body: { name: z.string(), parentId: objectId.nullable().optional() } }), asyncHandler(async (req, res) => {
  const name = cleanName(req.valid.body.name);
  const { parentId } = req.valid.body;
  let parent = null;
  if (parentId) ({ item: parent } = await loadItem('folder', parentId, req.user, 'editor'));
  const ownerId = parent ? parent.owner : req.user._id;
  await assertNameFree(ownerId, parent && parent._id, name);
  const folder = await Folder.create({
    name, owner: ownerId, parent: parent ? parent._id : null, ancestors: parent ? [...parent.ancestors, parent._id] : [],
  });
  audit(req, { action: 'folder.create', targetType: 'folder', targetId: folder._id, owner: ownerId });
  res.status(201).json(folderDTO(folder, parent ? undefined : 'owner'));
}));

async function listChildren(req, res, folder, role) {
  const filter = { parent: folder ? folder._id : null, trashed: false };
  if (!folder) filter.owner = req.user._id; // the root is per-user
  const { folders, files, pagination } = await paginateFoldersAndFiles(Folder, File, filter, filter, req.valid.query);
  res.json({
    folder: folder ? folderDTO(folder, role) : null,
    breadcrumbs: folder ? await access.breadcrumbs(folder, req.user, role) : [],
    items: [...folders.map((f) => folderDTO(f)), ...files.map((f) => fileDTO(f))],
    pagination,
  });
}

// Declared before /:id so "root" is not parsed as an id.
router.get('/root/items', validate({ query: pageQuery }), asyncHandler((req, res) => listChildren(req, res, null)));

router.get('/:id/items', validate({ params: idParam, query: pageQuery }), asyncHandler(async (req, res) => {
  const { item, role } = await loadItem('folder', req.valid.params.id, req.user, 'viewer');
  await listChildren(req, res, item, role);
}));

router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { item, role } = await loadItem('folder', req.valid.params.id, req.user, 'viewer');
  res.json({ ...folderDTO(item, role), breadcrumbs: await access.breadcrumbs(item, req.user, role) });
}));

// Rename and/or move.
router.patch('/:id', validate({
  params: idParam,
  body: { name: z.string().optional(), parentId: objectId.nullable().optional() },
}), asyncHandler(async (req, res) => {
  const { item: folder, role } = await loadItem('folder', req.valid.params.id, req.user, 'editor');
  const { name: rawName, parentId } = req.valid.body;
  if (rawName === undefined && parentId === undefined) throw badRequest('Provide name and/or parentId');

  const newName = rawName === undefined ? folder.name : cleanName(rawName);
  let dest = folder.parent ? { _id: folder.parent } : null;
  let moving = false;

  if (parentId !== undefined) {
    const target = parentId === null ? null : (await loadItem('folder', parentId, req.user, 'editor')).item;
    if (target === null && role !== 'owner') throw forbidden('Only the owner can move an item to the root');
    if (target && String(target.owner) !== String(folder.owner)) throw forbidden('Items cannot be moved between different owners');
    if (target && (String(target._id) === String(folder._id) || target.ancestors.some((a) => String(a) === String(folder._id)))) {
      throw badRequest('A folder cannot be moved into itself or its own subfolders', 'INVALID_MOVE');
    }
    moving = String(target ? target._id : '') !== String(folder.parent || '');
    dest = target;
    if (moving) await assertNameFree(folder.owner, target && target._id, newName, folder._id);
    if (moving) await reparentFolder(folder, target);
  }
  if (newName !== folder.name) {
    if (!moving) await assertNameFree(folder.owner, folder.parent, newName, folder._id);
    await Folder.updateOne({ _id: folder._id }, { $set: { name: newName } });
  }
  const fresh = await Folder.findById(folder._id);
  audit(req, { action: moving ? 'folder.move' : 'folder.rename', targetType: 'folder', targetId: folder._id, owner: folder.owner, meta: { name: newName, parentId: dest ? dest._id : null } });
  res.json(folderDTO(fresh, role));
}));

router.delete('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { item } = await loadItem('folder', req.valid.params.id, req.user, 'editor');
  await trash.trashFolder(item);
  audit(req, { action: 'folder.trash', targetType: 'folder', targetId: item._id, owner: item.owner });
  res.status(204).end();
}));

router.post('/:id/restore', validate({ params: idParam }), asyncHandler(async (req, res) => {
  const { item } = await loadItem('folder', req.valid.params.id, req.user, 'owner', { allowTrashed: true });
  if (!item.trashed) throw conflict('Folder is not in the trash', 'NOT_TRASHED');
  await trash.restoreFolder(item);
  audit(req, { action: 'folder.restore', targetType: 'folder', targetId: item._id, owner: item.owner });
  res.json(folderDTO(await Folder.findById(item._id), 'owner'));
}));

router.use('/:id/shares', sharesRouter('folder'));

module.exports = router;
