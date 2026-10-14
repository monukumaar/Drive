const mongoose = require('mongoose');
const config = require('./config');

async function connect(uri = config.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  // Make sure unique/partial indexes exist before we accept traffic:
  // correctness of duplicate-name handling depends on them.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  return mongoose.connection;
}

module.exports = { connect, disconnect: () => mongoose.disconnect() };
