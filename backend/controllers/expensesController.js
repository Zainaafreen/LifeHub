const pool   = require('../config/db');
const logger = require('../config/logger');

// GET /api/expenses?page=1&limit=50
async function getExpenses(req, res) {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const VALID_TYPES = ['income', 'expense'];
    const typeFilter  = VALID_TYPES.includes(req.query.type) ? req.query.type : null;

    const params      = [req.userId];
    const filterClause = typeFilter ? `AND type = $${params.push(typeFilter)}` : '';

    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT * FROM expenses WHERE user_id = $1 ${filterClause} ORDER BY date DESC, created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) FROM expenses WHERE user_id = $1 ${filterClause}`,
        params
      ),
    ]);

    const total = parseInt(countRes.rows[0].count);
    res.json({
      data:       dataRes.rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    logger.error({ err }, 'getExpenses error:', err.message);
    res.status(500).json({ error: 'Failed to fetch expenses' });
  }
}

// GET /api/expenses/summary
async function getSummary(req, res) {
  try {
    const result = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS total_income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses
       FROM expenses WHERE user_id = $1`,
      [req.userId]
    );
    const { total_income, total_expenses } = result.rows[0];
    const balance = parseFloat(total_income) - parseFloat(total_expenses);
    res.json({ total_income: parseFloat(total_income), total_expenses: parseFloat(total_expenses), balance });
  } catch (err) {
    logger.error({ err }, 'getSummary error:', err.message);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
}

// POST /api/expenses
async function createExpense(req, res) {
  try {
    // Validation is handled upstream by the Zod middleware (validate.js →
    // schemas.createExpense).  Any manual checks here would duplicate that
    // logic and silently drift when the schema changes.
    const { type, category, amount, description, date } = req.body;

    const result = await pool.query(
      'INSERT INTO expenses (user_id, type, category, amount, description, date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.userId, type, category.trim(), parseFloat(amount), description?.trim() || null, date || new Date()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'createExpense error:', err.message);
    res.status(500).json({ error: 'Failed to create expense' });
  }
}

// DELETE /api/expenses/:id
async function deleteExpense(req, res) {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json({ message: 'Expense deleted', id: result.rows[0].id });
  } catch (err) {
    logger.error({ err }, 'deleteExpense error:', err.message);
    res.status(500).json({ error: 'Failed to delete expense' });
  }
}

// PATCH /api/expenses/:id
// Updates one or more fields of an existing expense.
// Only the fields supplied in the request body are changed.
async function updateExpense(req, res) {
  try {
    const { id }  = req.params;
    // Validation is handled upstream by the Zod middleware (schemas.updateExpense).
    const { type, category, amount, description, date } = req.body;

    // Build the SET clause dynamically — only update supplied fields
    const fields = [];
    const values = [];
    let   idx    = 1;

    if (type        !== undefined) { fields.push(`type = $${idx++}`);        values.push(type); }
    if (category    !== undefined) { fields.push(`category = $${idx++}`);    values.push(category.trim()); }
    if (amount      !== undefined) { fields.push(`amount = $${idx++}`);      values.push(parseFloat(amount)); }
    if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description?.trim() || null); }
    if (date        !== undefined) { fields.push(`date = $${idx++}`);        values.push(date); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Append id and user_id as the final parameters
    values.push(id, req.userId);

    const result = await pool.query(
      `UPDATE expenses SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'updateExpense error:', err.message);
    res.status(500).json({ error: 'Failed to update expense' });
  }
}

module.exports = { getExpenses, getSummary, createExpense, updateExpense, deleteExpense };
