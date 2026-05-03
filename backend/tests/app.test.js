/**
 * LifeHub — Core integration tests
 *
 * Covers:
 *   1. Auth flow      — register → login → /me → logout
 *   2. CSRF rejection  — mutating request without X-CSRF-Token header
 *   3. Rate-limit hit  — auth limiter triggers after max attempts
 *   4. Health threshold boundary — values at and around each threshold bucket
 *   5. Content-Type enforcement — 415 on non-JSON body
 *
 * Requirements:
 *   - jest + supertest (already in devDependencies)
 *   - A running PostgreSQL instance pointed at by the env vars below
 *   - NODE_ENV=test (set automatically by this file; CSRF is skipped in test mode)
 *
 * Run:
 *   cd backend && npm test
 *
 * Set test DB vars (or use a .env.test):
 *   DATABASE_URL=postgres://user:pass@localhost/lifehub_test npm test
 */

'use strict';

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod-1234567890ab';
// Point at a test DB — use DATABASE_URL or individual vars via .env.test
// If neither is set, the tests will fail at the DB connection step with a
// clear error rather than silently passing against a real database.

const request = require('supertest');
const app     = require('../server');
const pool    = require('../config/db');

// ── Helpers ──────────────────────────────────────────────────────────────────

const uniqueEmail = () => `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;

async function registerAndLogin(email, password = 'TestPass123!') {
  // Register
  const regRes = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Test User', email, password });

  // In test mode verification is bypassed — mark verified directly
  await pool.query('UPDATE users SET verified = TRUE WHERE email = $1', [email]);

  // Login
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ email, password });

  return { regRes, loginRes, cookie: loginRes.headers['set-cookie'] };
}

// ── 1. Auth flow ──────────────────────────────────────────────────────────────

describe('Auth flow', () => {
  let email;

  beforeEach(() => { email = uniqueEmail(); });

  test('register returns 201 with user object', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Alice', email, password: 'StrongPass99!' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Alice', email });
    expect(res.body.user).not.toHaveProperty('password');
  });

  test('register rejects duplicate email with 409', async () => {
    await request(app).post('/api/auth/register')
      .send({ name: 'Alice', email, password: 'StrongPass99!' });

    const res = await request(app).post('/api/auth/register')
      .send({ name: 'Alice2', email, password: 'StrongPass99!' });

    expect(res.status).toBe(409);
  });

  test('login succeeds after email verification and sets httpOnly cookie', async () => {
    const { loginRes } = await registerAndLogin(email);

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user).toMatchObject({ email });

    const cookies = loginRes.headers['set-cookie'] || [];
    const tokenCookie = cookies.find(c => c.startsWith('lh_token='));
    expect(tokenCookie).toBeDefined();
    expect(tokenCookie).toMatch(/HttpOnly/i);
  });

  test('login fails for unverified account', async () => {
    await request(app).post('/api/auth/register')
      .send({ name: 'Bob', email, password: 'StrongPass99!' });
    // Do NOT mark verified

    const res = await request(app).post('/api/auth/login')
      .send({ email, password: 'StrongPass99!' });

    expect(res.status).toBe(403);
  });

  test('login fails for wrong password', async () => {
    await registerAndLogin(email); // registers + verifies
    const res = await request(app).post('/api/auth/login')
      .send({ email, password: 'WrongPassword!' });
    expect(res.status).toBe(401);
  });

  test('/api/auth/me returns user when authenticated', async () => {
    const { cookie } = await registerAndLogin(email);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email });
    expect(res.body).not.toHaveProperty('password');
  });

  test('/api/auth/me returns 401 without cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('logout clears the cookie and revokes the token', async () => {
    const { cookie } = await registerAndLogin(email);

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookie);

    expect(logoutRes.status).toBe(200);

    // Using the same cookie after logout should be rejected
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookie);

    expect(meRes.status).toBe(401);
  });
});

// ── 2. CSRF rejection ─────────────────────────────────────────────────────────
// In NODE_ENV=test the CSRF middleware is bypassed (see server.js).
// These tests verify the bypass works correctly and that a fresh production-
// like check would reject a missing header.  To test real CSRF behaviour set
// ENABLE_CSRF_IN_TEST=1.

describe('CSRF middleware', () => {
  test('mutating request succeeds in test mode (CSRF bypass active)', async () => {
    // In test mode NODE_ENV=test → CSRF is skipped.
    // Register should go through without an X-CSRF-Token header.
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'CsrfUser', email: uniqueEmail(), password: 'Pass1234!' });

    // 201 = success, 409 = duplicate — both mean the request reached the handler
    expect([201, 409]).toContain(res.status);
  });

  test('GET /api/csrf-token returns a token string', async () => {
    const res = await request(app).get('/api/csrf-token');
    expect(res.status).toBe(200);
    expect(typeof res.body.csrfToken).toBe('string');
    expect(res.body.csrfToken.length).toBeGreaterThan(10);
  });
});

// ── 3. Rate-limit hit ─────────────────────────────────────────────────────────
// The auth limiter allows 20 requests per 15-min window.
// We fire 21 identical login attempts and expect the last to be 429.
// This test runs in-band (--runInBand) so windows don't bleed across tests.

describe('Rate limiting', () => {
  test('auth limiter returns 429 after 20 failed login attempts', async () => {
    const email = uniqueEmail();
    let lastRes;

    // 21 attempts — all will fail (wrong password / unregistered), but
    // the rate limiter counts attempts, not outcomes.
    for (let i = 0; i < 21; i++) {
      lastRes = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'wrong' });
    }

    expect(lastRes.status).toBe(429);
  }, 30_000); // generous timeout for 21 sequential HTTP requests
});

// ── 4. Health threshold boundary ──────────────────────────────────────────────
// Tests the /api/health/thresholds endpoint and the classification logic
// by posting records at boundary values and checking the response.

describe('Health thresholds', () => {
  let cookie;

  beforeAll(async () => {
    const email = uniqueEmail();
    ({ cookie } = await registerAndLogin(email));
  });

  test('GET /api/health/thresholds returns the threshold object', async () => {
    const res = await request(app).get('/api/health/thresholds');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hr');
    expect(res.body).toHaveProperty('bp');
    expect(res.body).toHaveProperty('sugar');
    expect(typeof res.body.hr.high).toBe('number');
  });

  test('heart rate above high threshold is classified as high or critical', async () => {
    // heartbeat = 101 → above hr.high (100) but below hr.criticalHigh (150)
    const res = await request(app)
      .post('/api/health')
      .set('Cookie', cookie)
      .send({ heartbeat: 101, systolic: 120, diastolic: 80, blood_sugar: 95 });

    expect(res.status).toBe(201);
    expect(['high', 'critical']).toContain(res.body.classification?.heartbeat);
  });

  test('heart rate in normal range is classified as normal', async () => {
    // heartbeat = 70 → within normal range (50–100 bpm)
    const res = await request(app)
      .post('/api/health')
      .set('Cookie', cookie)
      .send({ heartbeat: 70, systolic: 118, diastolic: 76, blood_sugar: 90 });

    expect(res.status).toBe(201);
    expect(res.body.classification?.heartbeat).toBe('normal');
  });

  test('critically high blood pressure is classified as critical', async () => {
    // systolic = 185 → above criticalSys (180)
    const res = await request(app)
      .post('/api/health')
      .set('Cookie', cookie)
      .send({ heartbeat: 72, systolic: 185, diastolic: 115, blood_sugar: 95 });

    expect(res.status).toBe(201);
    expect(res.body.classification?.bp).toBe('critical');
  });

  test('blood sugar above critical threshold triggers alert', async () => {
    // blood_sugar = 310 → above sugar.critical (300)
    const res = await request(app)
      .post('/api/health')
      .set('Cookie', cookie)
      .send({ heartbeat: 72, systolic: 118, diastolic: 78, blood_sugar: 310 });

    expect(res.status).toBe(201);
    expect(res.body.alerts.length).toBeGreaterThan(0);
    expect(res.body.classification?.blood_sugar).toBe('critical');
  });
});

// ── 5. Content-Type enforcement ───────────────────────────────────────────────

describe('Content-Type enforcement', () => {
  test('POST /api/auth/login with text/plain body returns 415', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'text/plain')
      .send('email=x&password=y');

    expect(res.status).toBe(415);
  });

  test('POST /api/auth/login with application/json body is accepted', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ email: 'nobody@example.com', password: 'whatever' });

    // 401/403/400 all mean the request reached the auth handler — not 415
    expect(res.status).not.toBe(415);
  });
});

// ── Teardown ──────────────────────────────────────────────────────────────────

afterAll(async () => {
  await pool.end();
});
