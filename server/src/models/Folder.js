const { Schema, model } = require('mongoose');
const shareSchema = require('./shareSchema');

const folderSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 255 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
    // Materialised path: [root, ..., parent]. Gives O(1) permission inheritance
    // lookups and cheap "all descendants" queries (index on ancestors).
    ancestors: { type: [Schema.Types.ObjectId], default: [] },
    shares: { type: [shareSchema], default: [] },
    trashed: { type: Boolean, default: false },
    trashedAt: { type: Date },
    // _id of the item the user actually deleted. Equal to own _id for the
    // top-most trashed item; descendants point at the folder that took them along.
    trashedWith: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);

// No two live siblings share a name. Trashed items are excluded so a name can be reused.
folderSchema.index({ owner: 1, parent: 1, name: 1 }, { unique: true, partialFilterExpression: { trashed: false } });
folderSchema.index({ ancestors: 1 });
folderSchema.index({ 'shares.user': 1 });
folderSchema.index({ owner: 1, trashed: 1 });
folderSchema.index({ trashedWith: 1 });

module.exports = model('Folder', folderSchema);
