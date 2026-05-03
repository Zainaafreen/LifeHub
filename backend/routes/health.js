const express = require('express');
const router  = express.Router();
const { getLatest, getRecords, getTrend, createRecord, deleteRecord, getThresholds } =
  require('../controllers/healthController');
const { authenticate }      = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validate');
const validateId            = require('../middleware/validateId');

router.get('/thresholds', getThresholds);

router.use(authenticate);

router.get('/latest', getLatest);
router.get('/trend',  getTrend);
router.get('/',       getRecords);
router.post('/',      validate(schemas.createHealthRecord), createRecord);
router.delete('/:id', validateId, deleteRecord);

module.exports = router;
