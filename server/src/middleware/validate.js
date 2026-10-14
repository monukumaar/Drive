const { z } = require('zod');

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

/** Validate params/query/body with zod; parsed values land in req.valid. */
const validate = (schemas) => (req, res, next) => {
  try {
    req.valid = {};
    for (const part of ['params', 'query', 'body']) {
      if (schemas[part]) req.valid[part] = z.object(schemas[part]).strict().parse(req[part] || {});
    }
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { validate, objectId, z };
