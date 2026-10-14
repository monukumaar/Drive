const h = require('./helpers');
const { File } = require('../src/models');

beforeAll(h.setup);
afterAll(h.teardown);
beforeEach(h.reset);

const share = (owner, kind, id, email, role) =>
  h.request(h.app).post(`/api/${kind}/${id}/shares`).set(owner.auth).send({ email, role });

describe('access control', () => {
  test("another user cannot read, download, rename, delete or version someone's private file (404, not 403)", async () => {
    const alice = await h.register('alice');
    const mallory = await h.register('mallory');
    const f = (await h.upload(alice, 'secret', { name: 's.txt' })).body;

    expect((await h.request(h.app).get(`/api/files/${f.id}`).set(mallory.auth)).status).toBe(404);
    expect((await h.download(mallory, f.id)).status).toBe(404);
    expect((await h.request(h.app).patch(`/api/files/${f.id}`).set(mallory.auth).send({ name: 'x' })).status).toBe(404);
    expect((await h.request(h.app).delete(`/api/files/${f.id}`).set(mallory.auth)).status).toBe(404);
    expect((await h.newVersion(mallory, f.id, 'evil')).status).toBe(404);
    expect((await h.request(h.app).get(`/api/files/${f.id}/versions`).set(mallory.auth)).status).toBe(404);
    expect((await share(mallory, 'files', f.id, mallory.email, 'editor')).status).toBe(404);
    expect((await h.request(h.app).get('/api/folders/root/items').set(mallory.auth)).body.items).toHaveLength(0);
  });

  test('cannot upload into or create folders inside a folder you cannot edit; cannot read from it', async () => {
    const alice = await h.register('alice');
    const mallory = await h.register('mallory');
    const dir = (await h.mkdir(alice, 'private')).body;
    expect((await h.upload(mallory, 'x', { folderId: dir.id })).status).toBe(404);
    expect((await h.mkdir(mallory, 'sub', dir.id)).status).toBe(404);
    expect((await h.request(h.app).get(`/api/folders/${dir.id}/items`).set(mallory.auth)).status).toBe(404);
  });
});

describe('sharing', () => {
  test('viewer can read and download but not modify; editor can; revoke removes access', async () => {
    const owner = await h.register('owner');
    const viewer = await h.register('viewer');
    const editor = await h.register('editor');
    const f = (await h.upload(owner, 'v1', { name: 'doc.txt' })).body;
    expect((await share(owner, 'files', f.id, viewer.email, 'viewer')).status).toBe(201);
    expect((await share(owner, 'files', f.id, editor.email, 'editor')).status).toBe(201);

    expect((await h.download(viewer, f.id)).body.toString()).toBe('v1');
    expect((await h.request(h.app).patch(`/api/files/${f.id}`).set(viewer.auth).send({ name: 'n.txt' })).status).toBe(403);
    expect((await h.request(h.app).delete(`/api/files/${f.id}`).set(viewer.auth)).status).toBe(403);
    expect((await h.newVersion(viewer, f.id, 'nope')).status).toBe(403);
    expect((await share(viewer, 'files', f.id, editor.email, 'viewer')).status).toBe(403);

    const upd = await h.newVersion(editor, f.id, 'v2 by editor');
    expect(upd.status).toBe(200);
    expect((await h.download(owner, f.id)).body.toString()).toBe('v2 by editor');
    expect((await h.request(h.app).post(`/api/files/${f.id}/restore`).set(editor.auth)).status).toBe(403);
    expect((await h.request(h.app).post(`/api/files/${f.id}/link`).set(editor.auth).send({})).status).toBe(403);

    const shared = await h.request(h.app).get('/api/shared-with-me').set(viewer.auth);
    expect(shared.body.items.map((i) => i.name)).toEqual(['doc.txt']);

    const list = await h.request(h.app).get(`/api/files/${f.id}/shares`).set(owner.auth);
    expect(list.body.shares).toHaveLength(2);
    expect((await h.request(h.app).get(`/api/files/${f.id}/shares`).set(viewer.auth)).status).toBe(403);

    expect((await h.request(h.app).delete(`/api/files/${f.id}/shares/${viewer.id}`).set(owner.auth)).status).toBe(204);
    expect((await h.download(viewer, f.id)).status).toBe(404);
    expect((await h.request(h.app).delete(`/api/files/${f.id}/shares/${viewer.id}`).set(owner.auth)).status).toBe(404);
    // an editor cannot revoke another user, but can leave
    expect((await h.request(h.app).delete(`/api/files/${f.id}/shares/${owner.id}`).set(editor.auth)).status).toBe(403);
    expect((await h.request(h.app).delete(`/api/files/${f.id}/shares/${editor.id}`).set(editor.auth)).status).toBe(204);
  });

  test('sharing validation: unknown email 404, self 400, bad role 400; re-sharing changes the role', async () => {
    const owner = await h.register('owner');
    const other = await h.register('other');
    const f = (await h.upload(owner, 'x', { name: 'a.txt' })).body;
    expect((await share(owner, 'files', f.id, 'ghost@example.com', 'viewer')).status).toBe(404);
    expect((await share(owner, 'files', f.id, owner.email, 'viewer')).status).toBe(400);
    expect((await share(owner, 'files', f.id, other.email, 'admin')).status).toBe(400);
    await share(owner, 'files', f.id, other.email, 'viewer');
    await share(owner, 'files', f.id, other.email, 'editor');
    const list = await h.request(h.app).get(`/api/files/${f.id}/shares`).set(owner.auth);
    expect(list.body.shares).toHaveLength(1);
    expect(list.body.shares[0].role).toBe('editor');
  });

  test('folder shares are inherited by nested items; breadcrumbs do not leak ancestors', async () => {
    const owner = await h.register('owner');
    const friend = await h.register('friend');
    const top = (await h.mkdir(owner, 'TopSecretName')).body;
    const shared = (await h.mkdir(owner, 'Shared', top.id)).body;
    const deep = (await h.mkdir(owner, 'Deep', shared.id)).body;
    const f = (await h.upload(owner, 'x', { name: 'deep.txt', folderId: deep.id })).body;
    await share(owner, 'folders', shared.id, friend.email, 'viewer');

    expect((await h.request(h.app).get(`/api/files/${f.id}`).set(friend.auth)).body.role).toBe('viewer');
    expect((await h.download(friend, f.id)).status).toBe(200);
    expect((await h.request(h.app).get(`/api/folders/${top.id}`).set(friend.auth)).status).toBe(404);
    const listing = await h.request(h.app).get(`/api/folders/${deep.id}/items`).set(friend.auth);
    expect(listing.body.breadcrumbs.map((b) => b.name)).toEqual(['Shared', 'Deep']);
    expect(JSON.stringify(listing.body)).not.toMatch(/TopSecretName/);
    expect((await h.upload(friend, 'x', { folderId: deep.id })).status).toBe(403);
  });

  test('an editor on a shared folder can upload into it; the file belongs to the folder owner', async () => {
    const owner = await h.register('owner');
    const editor = await h.register('editor');
    const dir = (await h.mkdir(owner, 'Team')).body;
    await share(owner, 'folders', dir.id, editor.email, 'editor');
    const up = await h.upload(editor, 'abc', { name: 'from-editor.txt', folderId: dir.id });
    expect(up.status).toBe(201);
    expect(up.body.ownerId).toBe(owner.id);
    expect((await h.me(owner)).storageUsed).toBe(3);
    expect((await h.me(editor)).storageUsed).toBe(0);
    // cannot move it out into their own tree, nor to root
    const mine = (await h.mkdir(editor, 'Mine')).body;
    expect((await h.request(h.app).patch(`/api/files/${up.body.id}`).set(editor.auth).send({ parentId: mine.id })).status).toBe(403);
    expect((await h.request(h.app).patch(`/api/files/${up.body.id}`).set(editor.auth).send({ parentId: null })).status).toBe(403);
  });
});

describe('public links', () => {
  test('download works without auth, honours the download cap, and can be revoked', async () => {
    const owner = await h.register('owner');
    const f = (await h.upload(owner, 'public data', { name: 'p.txt' })).body;
    const link = await h.request(h.app).post(`/api/files/${f.id}/link`).set(owner.auth).send({ maxDownloads: 2 });
    expect(link.status).toBe(201);
    const raw = (res) => h.request(h.app).get(`/api/public/${link.body.token}`).buffer(true).parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect((await raw()).body.toString()).toBe('public data');
    expect((await raw()).status).toBe(200);
    expect((await raw()).status).toBe(404); // cap reached

    const stored = await File.findById(f.id);
    expect(JSON.stringify(stored.toObject())).not.toContain(link.body.token); // only a hash is stored

    const link2 = await h.request(h.app).post(`/api/files/${f.id}/link`).set(owner.auth).send({});
    expect((await h.request(h.app).get(`/api/public/${link2.body.token}`)).status).toBe(200);
    await h.request(h.app).delete(`/api/files/${f.id}/link`).set(owner.auth);
    expect((await h.request(h.app).get(`/api/public/${link2.body.token}`)).status).toBe(404);
  });

  test('expired links and unknown tokens return 404; trashed files are not served', async () => {
    const owner = await h.register('owner');
    const f = (await h.upload(owner, 'x', { name: 'p.txt' })).body;
    const link = await h.request(h.app).post(`/api/files/${f.id}/link`).set(owner.auth).send({ expiresInHours: 1 });
    await File.updateOne({ _id: f.id }, { 'link.expiresAt': new Date(Date.now() - 1000) });
    expect((await h.request(h.app).get(`/api/public/${link.body.token}`)).status).toBe(404);
    expect((await h.request(h.app).get(`/api/public/${'a'.repeat(43)}`)).status).toBe(404);
    const link2 = await h.request(h.app).post(`/api/files/${f.id}/link`).set(owner.auth).send({});
    await h.request(h.app).delete(`/api/files/${f.id}`).set(owner.auth);
    expect((await h.request(h.app).get(`/api/public/${link2.body.token}`)).status).toBe(404);
  });
});

describe('audit log', () => {
  test('owner sees actions by collaborators on their files', async () => {
    const owner = await h.register('owner');
    const viewer = await h.register('viewer');
    const f = (await h.upload(owner, 'x', { name: 'a.txt' })).body;
    await share(owner, 'files', f.id, viewer.email, 'viewer');
    await h.download(viewer, f.id);
    await new Promise((r) => setTimeout(r, 200)); // audit writes are fire-and-forget
    const res = await h.request(h.app).get('/api/audit').set(owner.auth);
    const actions = res.body.events.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['file.upload', 'file.share', 'file.download']));
    const dl = res.body.events.find((e) => e.action === 'file.download');
    expect(dl.actor.email).toBe(viewer.email);
    expect((await h.request(h.app).get('/api/audit').set(viewer.auth)).body.events).toHaveLength(0);
  });
});
