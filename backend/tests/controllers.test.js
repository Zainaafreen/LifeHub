/**
 * LifeHub — Tasks, Expenses, Health & Reminders integration tests
 *
 * Complements the auth/CSRF/rate-limit tests in app.test.js.
 * Requires the same test-DB setup (DATABASE_URL pointing at lifehub_test
 * with schema.sql applied).
 *
 * Run:
 *   cd backend && npm test
 */

'use strict';

process.env.NODE_ENV   = 'test';
process.env.JWT_SECRET = 'test-secret-do-not-use-in-prod-1234567890ab';

const request = require('supertest');
const app     = require('../server');
const pool    = require('../config/db');

// ── Helpers ───────────────────────────────────────────────────────────────────

const uniqueEmail = () =>
  `test_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`;

async function registerAndLogin(email, password = 'TestPass123!') {
  await request(app).post('/api/auth/register')
    .send({ name: 'Test User', email, password });

  await pool.query('UPDATE users SET verified = TRUE WHERE email = $1', [email]);

  const loginRes = await request(app).post('/api/auth/login')
    .send({ email, password });

  return { cookie: loginRes.headers['set-cookie'] };
}

// ── 1. Tasks ──────────────────────────────────────────────────────────────────

describe('Tasks CRUD', () => {
  let cookie;

  beforeAll(async () => {
    ({ cookie } = await registerAndLogin(uniqueEmail()));
  });

  afterAll(async () => {
    await pool.query('DELETE FROM users WHERE email LIKE \'test_%@example.com\'');
  });

  test('GET /api/tasks — returns empty array for new user', async () => {
    const res = await request(app).get('/api/tasks').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/tasks — creates a task', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Buy groceries', priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Buy groceries');
    expect(res.body.priority).toBe('high');
    expect(res.body.completed).toBe(false);
  });

  test('POST /api/tasks — 400 on missing title', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ priority: 'low' });
    expect(res.status).toBe(400);
  });

  test('POST /api/tasks — 400 on invalid priority', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Bad priority', priority: 'critical' });
    expect(res.status).toBe(400);
  });

  test('PATCH /api/tasks/:id — marks task complete', async () => {
    const create = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Patch me' });
    const id = create.body.id;

    const res = await request(app)
      .patch(`/api/tasks/${id}`)
      .set('Cookie', cookie)
      .send({ completed: true });
    expect(res.status).toBe(200);
    expect(res.body.completed).toBe(true);
  });

  test('PATCH /api/tasks/:id — 404 on wrong user task', async () => {
    const { cookie: otherCookie } = await registerAndLogin(uniqueEmail());
    const create = await request(app)
      .post('/api/tasks')
      .set('Cookie', otherCookie)
      .send({ title: 'Other user task' });
    const otherId = create.body.id;

    const res = await request(app)
      .patch(`/api/tasks/${otherId}`)
      .set('Cookie', cookie)   // wrong user
      .send({ completed: true });
    expect(res.status).toBe(404);
  });

  test('DELETE /api/tasks/:id — removes task', async () => {
    const create = await request(app)
      .post('/api/tasks')
      .set('Cookie', cookie)
      .send({ title: 'Delete me' });
    const id = create.body.id;

    const del = await request(app)
      .delete(`/api/tasks/${id}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(200);

    // Confirm gone
    const tasks = await request(app).get('/api/tasks').set('Cookie', cookie);
    expect(tasks.body.find(t => t.id === id)).toBeUndefined();
  });
});

// ── 2. Expenses ───────────────────────────────────────────────────────────────

describe('Expenses CRUD', () => {
  let cookie;

  beforeAll(async () => {
    ({ cookie } = await registerAndLogin(uniqueEmail()));
  });

  const validExpense = {
    type: 'expense',
    category: 'Food',
    amount: 42.50,
    date: '2024-06-01',
  };

  test('GET /api/expenses — returns paginated result', async () => {
    const res = await request(app).get('/api/expenses').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('POST /api/expenses — creates expense', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Cookie', cookie)
      .send(validExpense);
    expect(res.status).toBe(201);
    expect(parseFloat(res.body.amount)).toBeCloseTo(42.50);
    expect(res.body.category).toBe('Food');
  });

  test('POST /api/expenses — creates income', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Cookie', cookie)
      .send({ ...validExpense, type: 'income', amount: 1000, category: 'Salary' });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe('income');
  });

  test('POST /api/expenses — 400 on missing required fields', async () => {
    const res = await request(app)
      .post('/api/expenses')
      .set('Cookie', cookie)
      .send({ type: 'expense' });   // missing category, amount, date
    expect(res.status).toBe(400);
  });

  test('GET /api/expenses/summary — balance reflects income minus expenses', async () => {
    const res = await request(app).get('/api/expenses/summary').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balance');
    // income 1000 − expense 42.50 ≥ 0
    expect(res.body.balance).toBeGreaterThan(0);
  });

  test('DELETE /api/expenses/:id — removes expense', async () => {
    const create = await request(app)
      .post('/api/expenses')
      .set('Cookie', cookie)
      .send({ ...validExpense, amount: 5 });
    const id = create.body.id;

    const del = await request(app)
      .delete(`/api/expenses/${id}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(200);
  });

  test('DELETE /api/expenses/:id — 404 for non-existent', async () => {
    const res = await request(app)
      .delete('/api/expenses/00000000-0000-0000-0000-000000000000')
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

// ── 3. Health ─────────────────────────────────────────────────────────────────

describe('Health records', () => {
  let cookie;

  beforeAll(async () => {
    ({ cookie } = await registerAndLogin(uniqueEmail()));
  });

  const normalReading = {
    heart_rate: 72,
    systolic: 120,
    diastolic: 80,
    blood_sugar: 95,
  };

  test('GET /api/health — returns empty array', async () => {
    const res = await request(app).get('/api/health').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/health — creates a reading', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Cookie', cookie)
      .send(normalReading);
    expect(res.status).toBe(201);
    expect(res.body.heart_rate).toBe(72);
  });

  test('POST /api/health — response includes alert_level', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Cookie', cookie)
      .send(normalReading);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('alert_level');
  });

  test('GET /api/health/thresholds — returns threshold object', async () => {
    const res = await request(app)
      .get('/api/health/thresholds')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hr');
    expect(res.body).toHaveProperty('bp');
    expect(res.body).toHaveProperty('sugar');
  });

  test('POST /api/health — high heart rate triggers elevated alert', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Cookie', cookie)
      .send({ ...normalReading, heart_rate: 105 });
    expect(res.status).toBe(201);
    // alert_level should be something other than 'normal'
    expect(res.body.alert_level).not.toBe('normal');
  });
});

// ── 4. Reminders ──────────────────────────────────────────────────────────────

describe('Reminders CRUD', () => {
  let cookie;

  beforeAll(async () => {
    ({ cookie } = await registerAndLogin(uniqueEmail()));
  });

  const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +1 day

  test('GET /api/reminders — returns empty array', async () => {
    const res = await request(app).get('/api/reminders').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('POST /api/reminders — creates a reminder', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', cookie)
      .send({ title: 'Doctor appointment', remind_at: futureDate });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Doctor appointment');
    expect(res.body.notified).toBe(false);
  });

  test('POST /api/reminders — 400 on missing title', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', cookie)
      .send({ remind_at: futureDate });
    expect(res.status).toBe(400);
  });

  test('POST /api/reminders — 400 on invalid date', async () => {
    const res = await request(app)
      .post('/api/reminders')
      .set('Cookie', cookie)
      .send({ title: 'Bad date', remind_at: 'not-a-date' });
    expect(res.status).toBe(400);
  });

  test('GET /api/reminders/upcoming — only future reminders', async () => {
    const res = await request(app)
      .get('/api/reminders/upcoming')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach(r => {
      expect(new Date(r.remind_at).getTime()).toBeGreaterThan(Date.now() - 5000);
    });
  });

  test('PATCH /api/reminders/:id/notify — marks as notified', async () => {
    const create = await request(app)
      .post('/api/reminders')
      .set('Cookie', cookie)
      .send({ title: 'Notify me', remind_at: futureDate });
    const id = create.body.id;

    const res = await request(app)
      .patch(`/api/reminders/${id}/notify`)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.notified).toBe(true);
  });

  test('DELETE /api/reminders/:id — removes reminder', async () => {
    const create = await request(app)
      .post('/api/reminders')
      .set('Cookie', cookie)
      .send({ title: 'Delete me', remind_at: futureDate });
    const id = create.body.id;

    const del = await request(app)
      .delete(`/api/reminders/${id}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(200);
  });

  test('DELETE /api/reminders/:id — 404 on wrong user', async () => {
    const { cookie: otherCookie } = await registerAndLogin(uniqueEmail());
    const create = await request(app)
      .post('/api/reminders')
      .set('Cookie', otherCookie)
      .send({ title: 'Other', remind_at: futureDate });
    const otherId = create.body.id;

    const res = await request(app)
      .delete(`/api/reminders/${otherId}`)
      .set('Cookie', cookie);   // wrong user
    expect(res.status).toBe(404);
  });
});
