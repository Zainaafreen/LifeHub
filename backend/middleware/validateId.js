/**
 * validateId  — Express middleware that enforces integer-only :id params.
 *
 * Rejects:
 *   - Non-numeric strings  ("abc", "1.5", "1e3")
 *   - Zero or negative values
 *   - Values exceeding PostgreSQL's SERIAL max (2^31 - 1)
 *
 * Usage:
 *   router.delete('/:id', validateId, deleteTask);
 *   router.patch('/:id',  validateId, updateTask);
 */
function validateId(req, res, next) {
  const raw = req.params.id;

  // Must be a string of digits only (no sign, no decimal, no exponent)
  if (!/^\d+$/.test(raw)) {
    return res.status(400).json({ error: 'Invalid ID: must be a positive integer' });
  }

  const id = Number(raw);

  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) {
    return res.status(400).json({ error: 'Invalid ID: out of range' });
  }

  // Attach the coerced integer so controllers don't repeat the conversion
  req.params.id = id;
  next();
}

module.exports = validateId;
