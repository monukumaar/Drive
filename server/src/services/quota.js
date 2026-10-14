const { User } = require('../models');
const { AppError } = require('../utils/errors');

/**
 * Atomically reserve `bytes` against the owner's quota. The check and the
 * increment happen in one findOneAndUpdate, so concurrent uploads cannot
 * both squeeze under the limit.
 */
async function reserve(userId, bytes) {
  if (bytes === 0) return;
  const updated = await User.findOneAndUpdate(
    { _id: userId, $expr: { $lte: [{ $add: ['$storageUsed', bytes] }, '$quotaBytes'] } },
    { $inc: { storageUsed: bytes } },
    { new: true }
  );
  if (!updated) throw new AppError(507, 'QUOTA_EXCEEDED', 'Storage quota exceeded');
}

async function release(userId, bytes) {
  if (!bytes) return;
  await User.updateOne({ _id: userId }, { $inc: { storageUsed: -bytes } });
}

module.exports = { reserve, release };
