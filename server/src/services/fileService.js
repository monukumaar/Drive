const mongoose = require('mongoose');
const { File, Version } = require('../models');
const storage = require('../storage');
const quota = require('./quota');
const config = require('../config');
const { conflict, preconditionFailed } = require('../utils/errors');

/**
 * Upload pipeline (no multi-document transactions, so every step is compensated on failure):
 *   1. reserve quota atomically
 *   2. move the temp file to its permanent blob key
 *   3. insert the immutable Version
 *   4. insert / update the File that points at it
 * A failure at any step undoes the earlier ones, so a File record never exists
 * without a stored blob, and quota is never leaked.
 */
async function createFile({ ownerId, parentId, name, mimeType, tmpPath, size, actorId }) {
  const fileId = new mongoose.Types.ObjectId();
  const key = storage.newKey();
  const sha256 = await storage.hashFile(tmpPath);

  await quota.reserve(ownerId, size);
  let blobStored = false;
  let version = null;
  try {
    await storage.put(tmpPath, key);
    blobStored = true;
    version = await Version.create({ file: fileId, number: 1, size, mimeType, sha256, storageKey: key, createdBy: actorId });
    return await File.create({
      _id: fileId, name, owner: ownerId, parent: parentId || null, mimeType, size, currentVersion: 1,
    });
  } catch (err) {
    await Promise.allSettled([
      quota.release(ownerId, size),
      blobStored ? storage.remove(key) : null,
      version ? Version.deleteOne({ _id: version._id }) : null,
    ]);
    throw err;
  }
}

/**
 * Append a new version to an existing file.
 * `source` is either { tmpPath, size, mimeType } (fresh upload)
 * or { copyFromKey, size, mimeType, sha256 } (restoring an old version).
 * Concurrent writers are detected two ways: the unique (file, number) index and a
 * compare-and-set on File.currentVersion. The loser gets 409 and is fully rolled back.
 */
async function addVersion({ file, source, actorId, expectedVersion = null }) {
  if (expectedVersion !== null && expectedVersion !== file.currentVersion) {
    throw preconditionFailed(`File is at version ${file.currentVersion}, not ${expectedVersion}`);
  }
  const number = file.currentVersion + 1;
  const key = storage.newKey();
  const sha256 = source.sha256 || (await storage.hashFile(source.tmpPath));
  const { size, mimeType } = source;

  await quota.reserve(file.owner, size);
  let blobStored = false;
  let version = null;
  try {
    if (source.tmpPath) await storage.put(source.tmpPath, key);
    else await storage.copy(source.copyFromKey, key);
    blobStored = true;

    try {
      version = await Version.create({ file: file._id, number, size, mimeType, sha256, storageKey: key, createdBy: actorId });
    } catch (err) {
      if (err.code === 11000) throw conflict('The file was modified concurrently; reload and retry', 'VERSION_CONFLICT');
      throw err;
    }

    const res = await File.updateOne(
      { _id: file._id, currentVersion: file.currentVersion, trashed: false },
      { $set: { size, mimeType, currentVersion: number } }
    );
    if (res.modifiedCount !== 1) throw conflict('The file was modified concurrently; reload and retry', 'VERSION_CONFLICT');
  } catch (err) {
    await Promise.allSettled([
      quota.release(file.owner, size),
      blobStored ? storage.remove(key) : null,
      version ? Version.deleteOne({ _id: version._id }) : null,
    ]);
    throw err;
  }

  await pruneVersions(file._id, file.owner).catch((e) => console.error('version pruning failed:', e.message));
  return File.findById(file._id);
}

/** Keep only the newest N versions; frees blobs and quota for the rest. */
async function pruneVersions(fileId, ownerId) {
  const stale = await Version.find({ file: fileId }).sort({ number: -1 }).skip(config.maxVersionsPerFile);
  for (const v of stale) {
    // DB first, blob second: a crash leaves an unreferenced blob, never a dangling reference.
    // eslint-disable-next-line no-await-in-loop
    await Version.deleteOne({ _id: v._id });
    // eslint-disable-next-line no-await-in-loop
    await quota.release(ownerId, v.size);
    // eslint-disable-next-line no-await-in-loop
    await storage.remove(v.storageKey).catch(() => {});
  }
}

module.exports = { createFile, addVersion };
