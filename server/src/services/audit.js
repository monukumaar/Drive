const { AuditLog } = require('../models');

/** Best-effort audit trail: failures are logged but never fail the request. */
function audit(req, { action, targetType, targetId, owner, meta }) {
  AuditLog.create({
    actor: req.user ? req.user._id : owner,
    owner,
    action,
    targetType,
    targetId,
    meta,
    ip: req.ip,
  }).catch((err) => console.error('audit log failed:', err.message));
}

module.exports = { audit };
