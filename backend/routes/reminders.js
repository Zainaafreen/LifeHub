const express = require('express');
const router  = express.Router();
const { getReminders, getUpcoming, getDue, createReminder, markNotified, deleteReminder } =
  require('../controllers/remindersController');
const { authenticate }      = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const validateId            = require('../middleware/validateId');

router.use(authenticate);

router.get('/upcoming',     getUpcoming);
router.get('/due',          getDue);
router.get('/',             getReminders);
router.post('/',            validate(schemas.createReminder), createReminder);
router.patch('/:id/notify', validateId, markNotified);
router.delete('/:id',       validateId, deleteReminder);

module.exports = router;
