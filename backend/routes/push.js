/**
 * push.js  — Express router: /api/push
 *
 * Endpoints:
 *   POST /api/push/subscribe    — save a push subscription for the logged-in user
 *   DELETE /api/push/subscribe  — remove it
 *   GET  /api/push/vapid-key    — return the public VAPID key to the frontend
 *
 * Place this file at:  server/routes/push.js
 * Then in server.js add:
 *   app.use('/api/push', apiLimiter, require('./routes/push'));
 */

const express  = require('express');
const router   = express.Router();
const webpush  = require('web-push');
const pool     = require('../config/db');
const logger   = require('../config/logger');
const { authenticate } = require('../middleware/auth');

// ── VAPID setup ───────────────────────────────────────────────
// Add these to your .env file:
//   VAPID_PUBLIC_KEY=<your public key>
//   VAPID_PRIVATE_KEY=<your private key>
//   VAPID_EMAIL=mailto:you@yourdomain.com
webpush.setVapidDetails(
  process.env.VAPID_EMAIL    || 'mailto:admin@lifehub.app',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

// ── GET /api/push/vapid-key ───────────────────────────────────
router.get('/vapid-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ── POST /api/push/subscribe ──────────────────────────────────
router.post('/subscribe', authenticate, async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.auth || !keys?.p256dh) {
    return res.status(400).json({ error: 'Invalid push subscription object' });
  }

  try {
    // Upsert — one subscription per user/endpoint pair
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET p256dh = $3, auth = $4, updated_at = NOW()`,
      [req.userId, endpoint, keys.p256dh, keys.auth]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'push subscribe error');
    res.status(500).json({ error: 'Failed to save subscription' });
  }
});

// ── DELETE /api/push/subscribe ────────────────────────────────
router.delete('/subscribe', authenticate, async (req, res) => {
  const { endpoint } = req.body;
  try {
    await pool.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
      [req.userId, endpoint]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'push unsubscribe error');
    res.status(500).json({ error: 'Failed to remove subscription' });
  }
});

module.exports = router;