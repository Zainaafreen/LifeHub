/**
 * reminderScheduler.js — server-side push notification scheduler
 *
 * Polls the DB every 60 seconds for due reminders and sends Web Push
 * notifications to all subscribed devices for that user — even when
 * the user's browser is fully closed.
 *
 * Usage in server.js:
 *   const { startReminderScheduler } = require('./reminderScheduler');
 *   // call after server starts:
 *   startReminderScheduler();
 *
 * Place this file at:  server/reminderScheduler.js
 */

const webpush = require('web-push');
const pool    = require('./config/db');
const logger  = require('./config/logger');

const POLL_INTERVAL_MS = 60 * 1000; // check every 60 seconds

async function sendDuePushNotifications() {
  let dueReminders;

  try {
    // Find all reminders that are due and not yet notified
    const result = await pool.query(
      `SELECT r.id, r.user_id, r.title, r.description, r.remind_at
       FROM reminders r
       WHERE r.remind_at <= NOW()
         AND r.notified = FALSE
       ORDER BY r.remind_at ASC`
    );
    dueReminders = result.rows;
  } catch (err) {
    logger.error({ err }, 'reminderScheduler: failed to query due reminders');
    return;
  }

  if (!dueReminders.length) return;

  logger.info({ count: dueReminders.length }, 'reminderScheduler: sending push notifications');

  for (const reminder of dueReminders) {
    // Get all push subscriptions for this user
    let subscriptions;
    try {
      const subResult = await pool.query(
        'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
        [reminder.user_id]
      );
      subscriptions = subResult.rows;
    } catch (err) {
      logger.error({ err, reminderId: reminder.id }, 'reminderScheduler: failed to fetch subscriptions');
      continue;
    }

    // Build the push payload
    const payload = JSON.stringify({
      title:      `🔔 ${reminder.title}`,
      body:       reminder.description || 'Your reminder is due now.',
      reminderId: reminder.id,
    });

    // Send to each subscribed device
    const sendPromises = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
      } catch (err) {
        // 410 Gone = subscription expired/revoked — clean it up
        if (err.statusCode === 410) {
          logger.info({ endpoint: sub.endpoint }, 'reminderScheduler: removing expired subscription');
          await pool.query(
            'DELETE FROM push_subscriptions WHERE endpoint = $1',
            [sub.endpoint]
          ).catch(() => {});
        } else {
          logger.warn(
            { err, reminderId: reminder.id },
            'reminderScheduler: push send failed'
          );
          throw err;
        }
      }
    });

    const results = await Promise.allSettled(sendPromises);

results.forEach((r) => {

  if (r.status === 'rejected') {

    logger.error(
      { err: r.reason },
      'reminderScheduler: push delivery failed'
    );

  } else {

    logger.info(
      'reminderScheduler: push delivered successfully'
    );

  }

});

    // Mark the reminder as notified so it doesn't fire again
    try {
      await pool.query(
        'UPDATE reminders SET notified = TRUE WHERE id = $1',
        [reminder.id]
      );
    } catch (err) {
      logger.error({ err, reminderId: reminder.id }, 'reminderScheduler: failed to mark notified');
    }
  }
}

let _schedulerInterval = null;

function startReminderScheduler() {
  if (_schedulerInterval) return; // already running
  logger.info('reminderScheduler: started (60s interval)');
  // Run once immediately, then on interval
  sendDuePushNotifications();
  _schedulerInterval = setInterval(sendDuePushNotifications, POLL_INTERVAL_MS);
}

function stopReminderScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
  }
}

module.exports = { startReminderScheduler, stopReminderScheduler };