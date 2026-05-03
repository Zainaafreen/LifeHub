const pool   = require('../config/db');
const logger = require('../config/logger');

const VALID_PRIORITIES = ['low', 'medium', 'high'];

// GET /api/tasks
async function getTasks(req, res) {
  try {
    const result = await pool.query(
      `SELECT * FROM tasks WHERE user_id = $1
       ORDER BY
         CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'getTasks error:', err.message);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
}

// POST /api/tasks
async function createTask(req, res) {
  try {
    const { title, priority = 'medium' } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Task title is required' });
    }
    if (title.length > 255) {
      return res.status(400).json({ error: 'Task title must be 255 characters or fewer' });
    }
    if (!VALID_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: 'Priority must be low, medium, or high' });
    }

    const result = await pool.query(
      'INSERT INTO tasks (user_id, title, priority) VALUES ($1, $2, $3) RETURNING *',
      [req.userId, title.trim(), priority]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'createTask error:', err.message);
    res.status(500).json({ error: 'Failed to create task' });
  }
}

// PATCH /api/tasks/:id
async function updateTask(req, res) {
  try {
    const { id } = req.params;
    const { title, completed, priority } = req.body;

    const fields = [];
    const values = [];
    let idx = 1;

    if (title     !== undefined) {
      if (title.length > 255) {
        return res.status(400).json({ error: 'Task title must be 255 characters or fewer' });
      }
      fields.push(`title = $${idx++}`); values.push(title.trim());
    }
    if (completed !== undefined) { fields.push(`completed = $${idx++}`); values.push(completed); }
    if (priority  !== undefined) {
      if (!VALID_PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: 'Priority must be low, medium, or high' });
      }
      fields.push(`priority = $${idx++}`);
      values.push(priority);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    values.push(id, req.userId);
    const query = `UPDATE tasks SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx} RETURNING *`;
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'updateTask error:', err.message);
    res.status(500).json({ error: 'Failed to update task' });
  }
}

// DELETE /api/tasks/:id
async function deleteTask(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json({ message: 'Task deleted', id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, 'deleteTask error:', err.message);
    res.status(500).json({ error: 'Failed to delete task' });
  }
}

module.exports = { getTasks, createTask, updateTask, deleteTask };

