const { Schema, model } = require('mongoose');
const shareSchema = require('./shareSchema');

const fileSchema = new Schema(
  {
    name: { type: String, required: true, maxlength: 255 },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
    // Denormalised from the current version so listings never touch the versions collection.
    mimeType: { type: String, default: 'application/octet-stream' },
    size: { type: Number, required: true, min: 0 },
    currentVersion: { type: Number, required: true, min: 1 },
    shares: { type: [shareSchema], default: [] },
    // Optional public link. Only a SHA-256 of the token is stored.
    link: {
      tokenHash: { type: String },
      expiresAt: { type: Date, default: null },
      maxDownloads: { type: Number, default: null },
      downloads: { type: Number, default: 0 },
      createdAt: { type: Date },
    },
    trashed: { type: Boolean, default: false },
    trashedAt: { type: Date },
    trashedWith: { type: Schema.Types.ObjectId },
  },
  { timestamps: true }
);

fileSchema.index({ owner: 1, parent: 1, name: 1 }, { unique: true, partialFilterExpression: { trashed: false } });
fileSchema.index({ parent: 1 });
fileSchema.index({ 'shares.user': 1 });
fileSchema.index({ owner: 1, trashed: 1 });
fileSchema.index({ trashedWith: 1 });
fileSchema.index({ 'link.tokenHash': 1 }, { sparse: true });

module.exports = model('File', fileSchema);
