// Use MONGODB_URI_TEST if given (e.g. the docker-compose mongo); otherwise start an in-memory server.
module.exports = async () => {
  if (process.env.MONGODB_URI_TEST) return;
  const { MongoMemoryServer } = require('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();
  globalThis.__MONGOD__ = mongod;
  process.env.MONGODB_URI_TEST = `${mongod.getUri()}drive_test`;
};
