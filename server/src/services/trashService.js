const { File, Folder, Version } = require('../models');
const storage = require('../storage');
const quota = require('./quota');
const { freeName } = require('./access');
const { reparentFolder } = require('./folderService');

async function trashFile(file) {
  const now = new Date();
  await File.updateOne({ _id: file._id, trashed: false }, { $set: { trashed: true, trashedAt: now, trashedWith: file._id } });
}

/** Trash a folder together with everything below it, in one logical operation. */
async function trashFolder(folder) {
  const now = new Date();
  const descendantIds = await Folder.find({ ancestors: folder._id, trashed: false }).distinct('_id');
  const ids = [folder._id, ...descendantIds];
  const set = { $set: { trashed: true, trashedAt: now, trashedWith: folder._id } };
  await Folder.updateMany({ _id: { $in: ids }, trashed: false }, set);
  await File.updateMany({ parent: { $in: ids }, trashed: false }, set);
}

/** Parent is usable if it still exists and is not in the trash. */
async function usableParent(parentId) {
  if (!parentId) return null;
  const p = await Folder.findById(parentId);
  return p && !p.trashed ? p : null;
}

/**
 * Restore keeps owner, shares and (when possible) the original location.
 * If the original parent is gone or trashed the item returns to the owner's root.
 * Name clashes are resolved by renaming the restored item, never by overwriting.
 */
async function restoreFile(file) {
  const parent = await usableParent(file.parent);
  const name = await freeName(file.owner, parent && parent._id, file.name);
  await File.updateOne(
    { _id: file._id },
    { $set: { name, parent: parent ? parent._id : null, trashed: false }, $unset: { trashedAt: 1, trashedWith: 1 } }
  );
}

async function restoreFolder(folder) {
  const parent = await usableParent(folder.parent);
  const name = await freeName(folder.owner, parent && parent._id, folder.name);
  if (!parent && folder.parent) await reparentFolder(folder, null);
  await Folder.updateOne({ _id: folder._id }, { $set: { name } });

  const filter = { trashedWith: folder._id, trashed: true };
  const unset = { $set: { trashed: false }, $unset: { trashedAt: 1, trashedWith: 1 } };
  await Folder.updateMany(filter, unset);
  await File.updateMany(filter, unset);
}

async function purgeFile(file) {
  const versions = await Version.find({ file: file._id });
  const bytes = versions.reduce((n, v) => n + v.size, 0);
  // DB first, blobs second: worst case after a crash is an unreferenced blob.
  await Version.deleteMany({ file: file._id });
  await File.deleteOne({ _id: file._id });
  await quota.release(file.owner, bytes);
  await Promise.allSettled(versions.map((v) => storage.remove(v.storageKey)));
}

async function purgeFolder(folder) {
  const descendantIds = await Folder.find({ ancestors: folder._id }).distinct('_id');
  const ids = [folder._id, ...descendantIds];
  const files = await File.find({ parent: { $in: ids } });
  for (const f of files) {
    // eslint-disable-next-line no-await-in-loop
    await purgeFile(f);
  }
  await Folder.deleteMany({ _id: { $in: ids } });
}

/** Top-level trashed items of a user (the ones they actually deleted). */
const trashRoots = (ownerId) => ({ owner: ownerId, trashed: true, $expr: { $eq: ['$trashedWith', '$_id'] } });

async function emptyTrash(ownerId) {
  let count = 0;
  for (const d of await Folder.find(trashRoots(ownerId))) { await purgeFolder(d); count += 1; }
  for (const f of await File.find(trashRoots(ownerId))) { await purgeFile(f); count += 1; }
  return count;
}

module.exports = { trashFile, trashFolder, restoreFile, restoreFolder, purgeFile, purgeFolder, trashRoots, emptyTrash };
