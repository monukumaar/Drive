const h = require('./helpers');

beforeAll(h.setup);
afterAll(h.teardown);
beforeEach(h.reset);

describe('authentication', () => {
  test('register returns a token and the user; password hash is never exposed', async () => {
    const res = await h.request(h.app).post('/api/auth/register').send({ email: 'A@Example.com', name: 'A', password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('a@example.com');
    expect(res.body.token).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  test('duplicate email -> 409', async () => {
    const body = { email: 'dup@example.com', name: 'D', password: 'password123' };
    await h.request(h.app).post('/api/auth/register').send(body);
    const res = await h.request(h.app).post('/api/auth/register').send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('validation errors use the consistent error shape', async () => {
    const res = await h.request(h.app).post('/api/auth/register').send({ email: 'nope', name: '', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThanOrEqual(3);
  });

  test('login succeeds with correct password, fails (401) otherwise', async () => {
    await h.request(h.app).post('/api/auth/register').send({ email: 'l@example.com', name: 'L', password: 'password123' });
    const ok = await h.request(h.app).post('/api/auth/login').send({ email: 'l@example.com', password: 'password123' });
    expect(ok.status).toBe(200);
    const bad = await h.request(h.app).post('/api/auth/login').send({ email: 'l@example.com', password: 'wrongpass' });
    expect(bad.status).toBe(401);
    const unknown = await h.request(h.app).post('/api/auth/login').send({ email: 'x@example.com', password: 'password123' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(bad.body.error.message);
  });

  test('protected routes reject missing, malformed and forged tokens', async () => {
    expect((await h.request(h.app).get('/api/folders/root/items')).status).toBe(401);
    expect((await h.request(h.app).get('/api/folders/root/items').set('Authorization', 'Bearer garbage')).status).toBe(401);
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011' }, 'wrong-secret');
    expect((await h.request(h.app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });
});
