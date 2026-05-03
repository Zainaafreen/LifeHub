const pool   = require('../config/db');
const logger = require('../config/logger');

// GET /api/reminders
async function getReminders(req, res) {
  try {
    const result = await pool.query(
      'SELECT * FROM reminders WHERE user_id = $1 ORDER BY remind_at ASC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'getReminders error:', err.message);
    res.status(500).json({ error: 'Failed to fetch reminders' });
  }
}

// GET /api/reminders/upcoming
async function getUpcoming(req, res) {
  try {
    const result = await pool.query(
      `SELECT * FROM reminders
       WHERE user_id = $1 AND remind_at >= NOW()
       ORDER BY remind_at ASC LIMIT 5`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'getUpcoming error:', err.message);
    res.status(500).json({ error: 'Failed to fetch upcoming reminders' });
  }
}

// GET /api/reminders/due — reminders due now that haven't been notified yet
async function getDue(req, res) {
  try {
    const result = await pool.query(
      `SELECT * FROM reminders
       WHERE user_id = $1
         AND remind_at <= NOW()
         AND notified = FALSE
       ORDER BY remind_at ASC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'getDue error:', err.message);
    res.status(500).json({ error: 'Failed to fetch due reminders' });
  }
}

// POST /api/reminders
async function createReminder(req, res) {
  try {
    const { title, description, remind_at } = req.body;

    if (!title || !remind_at) {
      return res.status(400).json({ error: 'Title and reminder date/time are required' });
    }
    if (title.length > 255) {
      return res.status(400).json({ error: 'Title must be 255 characters or fewer' });
    }
    if (description && description.length > 1000) {
      return res.status(400).json({ error: 'Description must be 1000 characters or fewer' });
    }

    const remindDate = new Date(remind_at);
    if (isNaN(remindDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date/time format' });
    }

    const result = await pool.query(
      'INSERT INTO reminders (user_id, title, description, remind_at) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.userId, title.trim(), description?.trim() || null, remindDate]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'createReminder error:', err.message);
    res.status(500).json({ error: 'Failed to create reminder' });
  }
}

// PATCH /api/reminders/:id/notify — mark a reminder as notified
async function markNotified(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE reminders SET notified = TRUE WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'markNotified error:', err.message);
    res.status(500).json({ error: 'Failed to mark reminder as notified' });
  }
}

// DELETE /api/reminders/:id
async function deleteReminder(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reminder not found' });
    }
    res.json({ message: 'Reminder deleted', id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, 'deleteReminder error:', err.message);
    res.status(500).json({ error: 'Failed to delete reminder' });
  }
}

module.exports = { getReminders, getUpcoming, getDue, createReminder, markNotified, deleteReminder };

