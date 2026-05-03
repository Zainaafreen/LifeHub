const express    = require('express');
const router     = express.Router();
const { getTasks, createTask, updateTask, deleteTask } = require('../controllers/tasksController');
const { authenticate }      = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const validateId            = require('../middleware/validateId');

router.use(authenticate);

router.get('/',       getTasks);
router.post('/',      validate(schemas.createTask),  createTask);
router.patch('/:id',  validateId, validate(schemas.updateTask),   updateTask);
router.delete('/:id', validateId, deleteTask);

module.exports = router;
