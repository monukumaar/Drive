const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../src/app');
const db = require('../src/db');
const storage = require('../src/storage');

const app = createApp();
let counter = 0;

async function setup() {
  await storage.init();
  await db.connect(process.env.MONGODB_URI_TEST);
}

async function teardown() {
  await mongoose.connection.dropDatabase();
  await db.disconnect();
}

async function reset() {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  fs.rmSync(storage.base, { recursive: true, force: true });
  await storage.init();
}

async function register(name = 'user') {
  counter += 1;
  const email = `${name}${counter}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ email, name, password: 'password123' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { email, id: res.body.user.id, token: res.body.token, auth: { Authorization: `Bearer ${res.body.token}` } };
}

const upload = (user, content, { name = 'a.txt', folderId, type = 'text/plain' } = {}) => {
  const q = new URLSearchParams();
  if (folderId) q.set('folderId', folderId);
  return request(app).post(`/api/files?${q}`).set(user.auth).attach('file', Buffer.from(content), { filename: name, contentType: type });
};

const newVersion = (user, id, content, headers = {}) =>
  request(app).put(`/api/files/${id}/content`).set(user.auth).set(headers).attach('file', Buffer.from(content), { filename: 'x.txt' });

const mkdir = (user, name, parentId) => request(app).post('/api/folders').set(user.auth).send({ name, parentId });

const download = (user, id, version) =>
  request(app).get(`/api/files/${id}/download${version ? `?version=${version}` : ''}`).set(user.auth)
    .buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

const me = async (user) => (await request(app).get('/api/auth/me').set(user.auth)).body.user;

/** All blob files currently on disk (excluding the temp dir). */
function blobsOnDisk() {
  const out = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== '.tmp') walk(p); } else out.push(p);
  });
  walk(storage.base);
  return out;
}
const tmpFiles = () => fs.readdirSync(storage.tmpDir);

module.exports = { app, setup, teardown, reset, register, upload, newVersion, mkdir, download, me, blobsOnDisk, tmpFiles, request };
