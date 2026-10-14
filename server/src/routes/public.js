const express = require('express');
const crypto = require('crypto');
const { File, Version } = require('../models');
const { sendVersion } = require('./files');
const { validate, z } = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { notFound } = require('../utils/errors');

const router = express.Router();

// Unauthenticated download through a share link. Expiry and the download cap are
// enforced in the same atomic update that counts the download.
router.get('/:token', validate({ params: { token: z.string().min(20).max(100) } }), asyncHandler(async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(req.valid.params.token).digest('hex');
  const now = new Date();
  const file = await File.findOneAndUpdate(
    {
      'link.tokenHash': tokenHash,
      trashed: false,
      $and: [
        { $or: [{ 'link.expiresAt': null }, { 'link.expiresAt': { $gt: now } }] },
        { $or: [{ 'link.maxDownloads': null }, { $expr: { $lt: ['$link.downloads', '$link.maxDownloads'] } }] },
      ],
    },
    { $inc: { 'link.downloads': 1 } },
    { new: true }
  );
  // Same answer for unknown, expired, exhausted and revoked links.
  if (!file) throw notFound('This link is invalid or has expired');
  const version = await Version.findOne({ file: file._id, number: file.currentVersion });
  if (!version) throw notFound('This link is invalid or has expired');
  await sendVersion(res, file, version);
}));

module.exports = router;
