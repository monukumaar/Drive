const { Schema, model } = require('mongoose');

// One document per stored blob. Immutable once written.
const versionSchema = new Schema(
  {
    file: { type: Schema.Types.ObjectId, ref: 'File', required: true },
    number: { type: Number, required: true, min: 1 },
    size: { type: Number, required: true, min: 0 },
    mimeType: { type: String, default: 'application/octet-stream' },
    sha256: { type: String, required: true },
    storageKey: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Also the guard against two concurrent writers creating the same version number.
versionSchema.index({ file: 1, number: 1 }, { unique: true });

module.exports = model('Version', versionSchema);
