const pool   = require('../config/db');
const logger = require('../config/logger');

// ── GET /api/profile ─────────────────────────────────────────
async function getProfile(req, res) {
  const reqLog = logger.forRequest(req.id);
  try {
    const result = await pool.query(
      `SELECT id, name, email, age, gender,
              blood_group, emergency_contact, health_conditions,
              created_at
       FROM users WHERE id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    reqLog.error({ err }, 'getProfile error');
    res.status(500).json({ error: 'Server error' });
  }
}

// ── PATCH /api/profile ───────────────────────────────────────
// Accepts any subset of: name, email, age, gender,
//   blood_group, emergency_contact, health_conditions
async function updateProfile(req, res) {
  const reqLog = logger.forRequest(req.id);
  try {
    const allowed = ['name', 'email', 'age', 'gender',
                     'blood_group', 'emergency_contact', 'health_conditions'];

    const fields = [];
    const values = [];
    let   idx    = 1;

    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        fields.push(`${key} = $${idx++}`);
        values.push(req.body[key]);
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Basic validation
    if (req.body.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    if (req.body.email !== undefined) {
      const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRx.test(req.body.email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      // Check for duplicate email (excluding self)
      const dup = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id <> $2',
        [req.body.email.toLowerCase().trim(), req.userId]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'That email is already in use' });
      }
    }
    if (req.body.age !== undefined && req.body.age !== null) {
      const age = Number(req.body.age);
      if (!Number.isInteger(age) || age < 1 || age > 120) {
        return res.status(400).json({ error: 'Age must be between 1 and 120' });
      }
    }

    values.push(req.userId);
    const result = await pool.query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}
       RETURNING id, name, email, age, gender,
                 blood_group, emergency_contact, health_conditions, created_at`,
      values
    );

    reqLog.info({ userId: req.userId, fields: Object.keys(req.body) }, 'Profile updated');
    res.json({ user: result.rows[0] });
  } catch (err) {
    reqLog.error({ err }, 'updateProfile error');
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { getProfile, updateProfile };