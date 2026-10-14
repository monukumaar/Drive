const { Schema, model } = require('mongoose');

const auditSchema = new Schema(
  {
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true }, // owner of the affected resource
    action: { type: String, required: true },
    targetType: { type: String, enum: ['file', 'folder'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    meta: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditSchema.index({ owner: 1, createdAt: -1 });

module.exports = model('AuditLog', auditSchema);
