const { Schema, model } = require('mongoose');

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    passwordHash: { type: String, required: true, select: false },
    quotaBytes: { type: Number, required: true, min: 0 },
    storageUsed: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = model('User', userSchema);
