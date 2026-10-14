const { createApp } = require('./app');
const config = require('./config');
const db = require('./db');
const storage = require('./storage');

async function main() {
  await storage.init();
  await db.connect();
  const server = createApp().listen(config.port, () => console.log(`API listening on :${config.port} (docs at /api/docs)`));

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(async () => { await db.disconnect(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => { console.error('Failed to start:', err); process.exit(1); });
