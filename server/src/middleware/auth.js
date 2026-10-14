const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../models');
const { unauthorized } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch (_) {
    throw unauthorized('Invalid or expired token');
  }
  const user = await User.findById(payload.sub);
  if (!user) throw unauthorized('Invalid or expired token');
  req.user = user;
  next();
});

const signToken = (user) =>
  jwt.sign({ sub: String(user._id) }, config.jwtSecret, { algorithm: 'HS256', expiresIn: config.jwtExpiresIn });

module.exports = { authenticate, signToken };
