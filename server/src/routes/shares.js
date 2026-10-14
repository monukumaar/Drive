const express = require('express');
const { User } = require('../models');
const { loadItem, modelFor } = require('../services/access');
const { audit } = require('../services/audit');
const { validate, objectId, z } = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { badRequest, notFound, forbidden } = require('../utils/errors');

/** Sharing endpoints, identical for files and folders. Mounted at /:id/shares. */
module.exports = (kind) => {
  const router = express.Router({ mergeParams: true });
  const Model = modelFor(kind);
  const idParam = { id: objectId };

  router.get('/', validate({ params: idParam }), asyncHandler(async (req, res) => {
    const { item } = await loadItem(kind, req.valid.params.id, req.user, 'owner');
    const users = await User.find({ _id: { $in: item.shares.map((s) => s.user) } }).select('email name');
    const byId = new Map(users.map((u) => [String(u._id), u]));
    res.json({
      shares: item.shares.map((s) => {
        const u = byId.get(String(s.user));
        return { userId: s.user, email: u && u.email, name: u && u.name, role: s.role, createdAt: s.createdAt };
      }),
    });
  }));

  // Create or change a share (idempotent per user).
  router.post('/', validate({
    params: idParam,
    body: { email: z.string().trim().toLowerCase().email(), role: z.enum(['viewer', 'editor']) },
  }), asyncHandler(async (req, res) => {
    const { item } = await loadItem(kind, req.valid.params.id, req.user, 'owner');
    const { email, role } = req.valid.body;
    const target = await User.findOne({ email });
    if (!target) throw notFound('No registered user with that email');
    if (String(target._id) === String(req.user._id)) throw badRequest('You already own this item', 'INVALID_SHARE');

    const updated = await Model.updateOne({ _id: item._id, 'shares.user': target._id }, { $set: { 'shares.$.role': role } });
    if (updated.matchedCount === 0) {
      await Model.updateOne({ _id: item._id, 'shares.user': { $ne: target._id } }, { $push: { shares: { user: target._id, role } } });
    }
    audit(req, { action: `${kind}.share`, targetType: kind, targetId: item._id, owner: item.owner, meta: { with: target.email, role } });
    res.status(201).json({ userId: target._id, email: target.email, role });
  }));

  // Owners revoke anyone's access; a recipient may remove their own share ("leave").
  router.delete('/:userId', validate({ params: { ...idParam, userId: objectId } }), asyncHandler(async (req, res) => {
    const { item, role } = await loadItem(kind, req.valid.params.id, req.user, 'viewer');
    const { userId } = req.valid.params;
    if (role !== 'owner' && userId !== String(req.user._id)) throw forbidden('Only the owner can revoke other users');
    const result = await Model.updateOne(
  { _id: item._id, 'shares.user': userId },
  { $pull: { shares: { user: userId } } }
);
if (result.matchedCount === 0) throw notFound('That user does not have a share on this item');
    audit(req, { action: `${kind}.unshare`, targetType: kind, targetId: item._id, owner: item.owner, meta: { userId } });
    res.status(204).end();
  }));

  return router;
};

