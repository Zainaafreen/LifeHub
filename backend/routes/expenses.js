const express = require('express');
const router  = express.Router();
const { getExpenses, getSummary, createExpense, updateExpense, deleteExpense } =
  require('../controllers/expensesController');
const { authenticate }      = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const validateId            = require('../middleware/validateId');

router.use(authenticate);

router.get('/summary', getSummary);
router.get('/',        getExpenses);
router.post('/',       validate(schemas.createExpense), createExpense);
router.patch('/:id',   validateId, validate(schemas.updateExpense), updateExpense);
router.delete('/:id',  validateId, deleteExpense);

module.exports = router;
