const mongoose = require('mongoose');
const { Folder } = require('../models');

/**
 * Point a folder (and its whole subtree) at a new parent by rewriting the
 * materialised `ancestors` paths. Files only reference their direct parent,
 * so they need no update.
 */
async function reparentFolder(folder, newParent) {
  const prefix = newParent ? [...newParent.ancestors, newParent._id] : [];
  const oid = (id) => new mongoose.Types.ObjectId(String(id));
  const prefixIds = prefix.map(oid);
  const folderId = oid(folder._id);

  // Descendants: keep the part of the old path from this folder downwards.
  await Folder.updateMany(
    { ancestors: folderId },
    [{
      $set: {
        ancestors: {
          $concatArrays: [
            { $literal: prefixIds },
            { $slice: ['$ancestors', { $indexOfArray: ['$ancestors', folderId] }, 1000] },
          ],
        },
      },
    }],
    { updatePipeline: true }
  );
  await Folder.updateOne({ _id: folderId }, { $set: { parent: newParent ? newParent._id : null, ancestors: prefixIds } });
}

module.exports = { reparentFolder };
