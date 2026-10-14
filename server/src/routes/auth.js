const express = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { User } = require('../models');
const { authenticate, signToken } = require('../middleware/auth');
const { validate, z } = require('../middleware/validate');
const asyncHandler = require('../utils/asyncHandler');
const { conflict, unauthorized } = require('../utils/errors');

const router = express.Router();

const userDTO = (u) => ({ id: u._id, email: u.email, name: u.name, quotaBytes: u.quotaBytes, storageUsed: u.storageUsed });
// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

router.post('/register', validate({
  body: {
    email: z.string().trim().toLowerCase().email().max(254),
    name: z.string().trim().min(1).max(100),
    password: z.string().min(8).max(128),
  },
}), asyncHandler(async (req, res) => {
  const { email, name, password } = req.valid.body;
  if (await User.exists({ email })) throw conflict('Email is already registered', 'EMAIL_TAKEN');
  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  let user;
  try {
    user = await User.create({ email, name, passwordHash, quotaBytes: config.defaultQuotaBytes });
  } catch (err) {
    if (err.code === 11000) throw conflict('Email is already registered', 'EMAIL_TAKEN');
    throw err;
  }
  res.status(201).json({ user: userDTO(user), token: signToken(user) });
}));

router.post('/login', validate({
  body: { email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) },
}), asyncHandler(async (req, res) => {
  const { email, password } = req.valid.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');
  res.json({ user: userDTO(user), token: signToken(user) });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: userDTO(req.user) }));

module.exports = router;
