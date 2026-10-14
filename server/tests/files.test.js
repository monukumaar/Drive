const h = require('./helpers');
const { File, Version, User } = require('../src/models');

beforeAll(h.setup);
afterAll(h.teardown);
beforeEach(h.reset);

describe('upload / download', () => {
  test('round trip keeps content, size, mime type and sets attachment headers', async () => {
    const u = await h.register();
    const up = await h.upload(u, 'hello world', { name: 'hello.txt' });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ name: 'hello.txt', size: 11, mimeType: 'text/plain', currentVersion: 1, ownerId: u.id });
    expect(up.body.storageKey).toBeUndefined();

    const dl = await h.download(u, up.body.id);
    expect(dl.status).toBe(200);
    expect(dl.body.toString()).toBe('hello world');
    expect(dl.headers['content-disposition']).toMatch(/^attachment/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
  });

  test('path traversal in filenames is neutralised', async () => {
    const u = await h.register();
    const up = await h.upload(u, 'x', { name: '../../etc/passwd' });
    expect(up.status).toBe(201);
    expect(up.body.name).toBe('passwd');
    const bad = await h.request(h.app).post('/api/files?name=..%2Fevil').set(u.auth).attach('file', Buffer.from('x'), 'a.txt');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_NAME');
    // every blob is inside the storage dir
    h.blobsOnDisk().forEach((p) => expect(p.startsWith(require('../src/storage').base)).toBe(true));
  });

  test('duplicate name in the same folder -> 409 and nothing is stored', async () => {
    const u = await h.register();
    await h.upload(u, 'one', { name: 'same.txt' });
    const before = h.blobsOnDisk().length;
    const res = await h.upload(u, 'two', { name: 'same.txt' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_NAME');
    expect(h.blobsOnDisk().length).toBe(before);
    expect((await h.me(u)).storageUsed).toBe(3);
    expect(h.tmpFiles()).toHaveLength(0);
  });

  test('missing file field -> 400; unknown id -> 404; malformed id -> 400', async () => {
    const u = await h.register();
    const res = await h.request(h.app).post('/api/files').set(u.auth).field('x', 'y');
    expect(res.status).toBe(400);
    expect((await h.download(u, '507f1f77bcf86cd799439011')).status).toBe(404);
    expect((await h.request(h.app).get('/api/files/not-an-id').set(u.auth)).status).toBe(400);
  });

  test('over the size limit -> 413 and no temp files remain', async () => {
    const u = await h.register();
    const res = await h.upload(u, Buffer.alloc(1.5 * 1024 * 1024, 1), { name: 'big.bin' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(await File.countDocuments()).toBe(0);
    expect(h.tmpFiles()).toHaveLength(0);
  });
});

describe('storage quota and failure handling', () => {
  test('upload beyond quota -> 507, no record, no blob, usage unchanged', async () => {
    const u = await h.register();
    await User.updateOne({ _id: u.id }, { quotaBytes: 10 });
    expect((await h.upload(u, '1234567890', { name: 'fits.txt' })).status).toBe(201);
    const res = await h.upload(u, 'x', { name: 'nope.txt' });
    expect(res.status).toBe(507);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(await File.countDocuments()).toBe(1);
    expect(h.blobsOnDisk()).toHaveLength(1);
    expect((await h.me(u)).storageUsed).toBe(10);
  });

  test('concurrent uploads cannot jointly exceed the quota', async () => {
    const u = await h.register();
    await User.updateOne({ _id: u.id }, { quotaBytes: 10 });
    const results = await Promise.all([1, 2, 3, 4].map((i) => h.upload(u, '123456', { name: `f${i}.txt` })));
    const created = results.filter((r) => r.status === 201).length;
    expect(created).toBe(1);
    expect((await h.me(u)).storageUsed).toBe(6);
  });

  test('a database failure during upload rolls back blob, version and quota', async () => {
    const u = await h.register();
    const spy = jest.spyOn(File, 'create').mockRejectedValueOnce(new Error('db down'));
    const res = await h.upload(u, 'payload', { name: 'x.txt' });
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(await Version.countDocuments()).toBe(0);
    expect(await File.countDocuments()).toBe(0);
    expect(h.blobsOnDisk()).toHaveLength(0);
    expect(h.tmpFiles()).toHaveLength(0);
    expect((await h.me(u)).storageUsed).toBe(0);
  });
});

describe('folders, listing, rename, move', () => {
  test('nested folders, breadcrumbs, and paginated listing (folders first)', async () => {
    const u = await h.register();
    const a = (await h.mkdir(u, 'A')).body;
    const b = (await h.mkdir(u, 'B', a.id)).body;
    for (let i = 0; i < 5; i += 1) await h.upload(u, 'x', { name: `f${i}.txt`, folderId: b.id });
    await h.mkdir(u, 'sub', b.id);

    const p1 = await h.request(h.app).get(`/api/folders/${b.id}/items?limit=4&page=1`).set(u.auth);
    expect(p1.status).toBe(200);
    expect(p1.body.breadcrumbs.map((c) => c.name)).toEqual(['A', 'B']);
    expect(p1.body.pagination).toMatchObject({ total: 6, totalPages: 2, folderCount: 1, fileCount: 5 });
    expect(p1.body.items.map((i) => i.name)).toEqual(['sub', 'f0.txt', 'f1.txt', 'f2.txt']);
    const p2 = await h.request(h.app).get(`/api/folders/${b.id}/items?limit=4&page=2`).set(u.auth);
    expect(p2.body.items.map((i) => i.name)).toEqual(['f3.txt', 'f4.txt']);

    const root = await h.request(h.app).get('/api/folders/root/items').set(u.auth);
    expect(root.body.items.map((i) => i.name)).toEqual(['A']);
  });

  test('rename conflicts, and invalid pagination, are rejected', async () => {
    const u = await h.register();
    const f1 = (await h.upload(u, 'a', { name: 'one.txt' })).body;
    await h.upload(u, 'b', { name: 'two.txt' });
    const clash = await h.request(h.app).patch(`/api/files/${f1.id}`).set(u.auth).send({ name: 'two.txt' });
    expect(clash.status).toBe(409);
    const ok = await h.request(h.app).patch(`/api/files/${f1.id}`).set(u.auth).send({ name: 'renamed.txt' });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('renamed.txt');
    expect((await h.request(h.app).get('/api/folders/root/items?limit=1000').set(u.auth)).status).toBe(400);
  });

  test('moving files and folders; cycles are refused; names checked at destination', async () => {
    const u = await h.register();
    const a = (await h.mkdir(u, 'A')).body;
    const b = (await h.mkdir(u, 'B', a.id)).body;
    const c = (await h.mkdir(u, 'C', b.id)).body;

    const cycle = await h.request(h.app).patch(`/api/folders/${a.id}`).set(u.auth).send({ parentId: c.id });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.code).toBe('INVALID_MOVE');
    expect((await h.request(h.app).patch(`/api/folders/${a.id}`).set(u.auth).send({ parentId: a.id })).status).toBe(400);

    // move B (with C inside) to root; C's breadcrumb must follow
    const moved = await h.request(h.app).patch(`/api/folders/${b.id}`).set(u.auth).send({ parentId: null });
    expect(moved.status).toBe(200);
    const cMeta = await h.request(h.app).get(`/api/folders/${c.id}`).set(u.auth);
    expect(cMeta.body.breadcrumbs.map((x) => x.name)).toEqual(['B', 'C']);

    const f = (await h.upload(u, 'x', { name: 'dup.txt' })).body;
    await h.upload(u, 'y', { name: 'dup.txt', folderId: c.id });
    const clash = await h.request(h.app).patch(`/api/files/${f.id}`).set(u.auth).send({ parentId: c.id });
    expect(clash.status).toBe(409);
  });
});

describe('versions', () => {
  test('replacing content keeps history; versions can be listed, downloaded and restored', async () => {
    const u = await h.register();
    const f = (await h.upload(u, 'v1', { name: 'doc.txt' })).body;
    const r2 = await h.newVersion(u, f.id, 'version-two');
    expect(r2.status).toBe(200);
    expect(r2.body.currentVersion).toBe(2);

    const list = await h.request(h.app).get(`/api/files/${f.id}/versions`).set(u.auth);
    expect(list.body.versions.map((v) => [v.number, v.isCurrent])).toEqual([[2, true], [1, false]]);
    expect((await h.download(u, f.id, 1)).body.toString()).toBe('v1');
    expect((await h.download(u, f.id)).body.toString()).toBe('version-two');

    const restored = await h.request(h.app).post(`/api/files/${f.id}/versions/1/restore`).set(u.auth);
    expect(restored.status).toBe(200);
    expect(restored.body.currentVersion).toBe(3);
    expect((await h.download(u, f.id)).body.toString()).toBe('v1');
    expect((await h.download(u, f.id, 2)).body.toString()).toBe('version-two');
    expect((await h.request(h.app).post(`/api/files/${f.id}/versions/3/restore`).set(u.auth)).status).toBe(400);
    expect((await h.request(h.app).post(`/api/files/${f.id}/versions/99/restore`).set(u.auth)).status).toBe(404);
  });

  test('If-Match gives optimistic concurrency (412) and stale writers leave no residue', async () => {
    const u = await h.register();
    const f = (await h.upload(u, 'v1', { name: 'doc.txt' })).body;
    await h.newVersion(u, f.id, 'v2', { 'If-Match': '1' });
    const before = h.blobsOnDisk().length;
    const stale = await h.newVersion(u, f.id, 'v3', { 'If-Match': '1' });
    expect(stale.status).toBe(412);
    expect(h.blobsOnDisk().length).toBe(before);
    expect(await Version.countDocuments({ file: f.id })).toBe(2);
  });

  test('old versions are pruned beyond MAX_VERSIONS_PER_FILE and their quota is freed', async () => {
    const u = await h.register();
    const f = (await h.upload(u, 'aaaa', { name: 'doc.txt' })).body;
    for (const c of ['bbbb', 'cccc', 'dddd', 'eeee']) await h.newVersion(u, f.id, c);
    const versions = await Version.find({ file: f.id }).sort({ number: 1 });
    expect(versions.map((v) => v.number)).toEqual([3, 4, 5]); // limit is 3 in tests
    expect(h.blobsOnDisk()).toHaveLength(3);
    expect((await h.me(u)).storageUsed).toBe(12);
  });
});

describe('trash', () => {
  test('trash hides items, restore brings back the whole tree with permissions intact', async () => {
    const owner = await h.register('owner');
    const friend = await h.register('friend');
    const dir = (await h.mkdir(owner, 'Docs')).body;
    const file = (await h.upload(owner, 'data', { name: 'a.txt', folderId: dir.id })).body;
    await h.request(h.app).post(`/api/folders/${dir.id}/shares`).set(owner.auth).send({ email: friend.email, role: 'viewer' });

    expect((await h.request(h.app).delete(`/api/folders/${dir.id}`).set(owner.auth)).status).toBe(204);
    expect((await h.request(h.app).get(`/api/files/${file.id}`).set(owner.auth)).status).toBe(404);
    expect((await h.request(h.app).get(`/api/files/${file.id}`).set(friend.auth)).status).toBe(404);
    const trash = await h.request(h.app).get('/api/trash').set(owner.auth);
    expect(trash.body.items.map((i) => i.name)).toEqual(['Docs']); // only the top-level item

    expect((await h.request(h.app).post(`/api/folders/${dir.id}/restore`).set(owner.auth)).status).toBe(200);
    expect((await h.request(h.app).get(`/api/files/${file.id}`).set(owner.auth)).status).toBe(200);
    const asFriend = await h.request(h.app).get(`/api/files/${file.id}`).set(friend.auth);
    expect(asFriend.status).toBe(200);
    expect(asFriend.body.role).toBe('viewer');
    expect((await h.request(h.app).post(`/api/folders/${dir.id}/restore`).set(owner.auth)).status).toBe(409);
  });

  test('restoring into a name that was reused renames instead of overwriting', async () => {
    const u = await h.register();
    const f = (await h.upload(u, 'old', { name: 'r.txt' })).body;
    await h.request(h.app).delete(`/api/files/${f.id}`).set(u.auth);
    await h.upload(u, 'new', { name: 'r.txt' }); // name is free again while trashed
    const res = await h.request(h.app).post(`/api/files/${f.id}/restore`).set(u.auth);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('r.txt (restored)');
  });

  test('a file restored from a still-trashed folder lands in the root', async () => {
    const u = await h.register();
    const dir = (await h.mkdir(u, 'D')).body;
    const f = (await h.upload(u, 'x', { name: 'in.txt', folderId: dir.id })).body;
    await h.request(h.app).delete(`/api/folders/${dir.id}`).set(u.auth);
    // restoring one file out of a trashed folder puts it back at the root
    expect((await h.request(h.app).post(`/api/files/${f.id}/restore`).set(u.auth)).status).toBe(200);
    const meta = await h.request(h.app).get(`/api/files/${f.id}`).set(u.auth);
    expect(meta.body.parentId).toBeNull();
  });

  test('permanent delete removes blobs and returns quota; live items cannot be purged', async () => {
    const u = await h.register();
    const f = (await h.upload(u, 'abcdef', { name: 'p.txt' })).body;
    await h.newVersion(u, f.id, 'ghij');
    expect((await h.request(h.app).delete(`/api/trash/files/${f.id}`).set(u.auth)).status).toBe(409);
    await h.request(h.app).delete(`/api/files/${f.id}`).set(u.auth);
    expect((await h.request(h.app).delete(`/api/trash/files/${f.id}`).set(u.auth)).status).toBe(204);
    expect(h.blobsOnDisk()).toHaveLength(0);
    expect(await Version.countDocuments()).toBe(0);
    expect((await h.me(u)).storageUsed).toBe(0);
  });

  test('empty trash purges everything that was deleted', async () => {
    const u = await h.register();
    const d = (await h.mkdir(u, 'D')).body;
    await h.upload(u, 'one', { name: 'a.txt', folderId: d.id });
    const f = (await h.upload(u, 'two', { name: 'b.txt' })).body;
    await h.request(h.app).delete(`/api/folders/${d.id}`).set(u.auth);
    await h.request(h.app).delete(`/api/files/${f.id}`).set(u.auth);
    const res = await h.request(h.app).delete('/api/trash').set(u.auth);
    expect(res.body.purged).toBe(2);
    expect(h.blobsOnDisk()).toHaveLength(0);
    expect(await File.countDocuments()).toBe(0);
    expect((await h.me(u)).storageUsed).toBe(0);
  });
});
