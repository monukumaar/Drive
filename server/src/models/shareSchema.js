const { Schema } = require('mongoose');

// Embedded in File and Folder. Shares are few per item, so embedding keeps
// permission checks to a single read; the multikey index on shares.user
// powers "Shared with me".
module.exports = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['viewer', 'editor'], required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);
