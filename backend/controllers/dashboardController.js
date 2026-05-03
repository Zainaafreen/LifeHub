const pool   = require('../config/db');
const logger = require('../config/logger');

// GET /api/dashboard
async function getDashboard(req, res) {
  try {
    const uid = req.userId;

    const [tasks, balance, latestHealth, upcomingReminders] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN completed = true THEN 1 ELSE 0 END) AS completed
         FROM tasks WHERE user_id = $1`,
        [uid]
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS income,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS expenses
         FROM expenses WHERE user_id = $1`,
        [uid]
      ),
      pool.query(
        'SELECT * FROM health_records WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1',
        [uid]
      ),
      pool.query(
        `SELECT * FROM reminders WHERE user_id = $1 AND remind_at >= NOW() AND notified = FALSE
         ORDER BY remind_at ASC LIMIT 5`,
        [uid]
      ),
    ]);

    const taskData = tasks.rows[0];
    const balData  = balance.rows[0];

    res.json({
      tasks: {
        total:     parseInt(taskData.total),
        completed: parseInt(taskData.completed || 0),
        pending:   parseInt(taskData.total) - parseInt(taskData.completed || 0),
      },
      balance: parseFloat(balData.income) - parseFloat(balData.expenses),
      latestHealth: latestHealth.rows[0] || null,
      upcomingReminders: upcomingReminders.rows,
    });
  } catch (err) {
    logger.error({ err }, 'getDashboard error');
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
}

module.exports = { getDashboard };