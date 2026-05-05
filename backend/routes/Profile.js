const express = require('express');
const router  = express.Router();
const { getProfile, updateProfile } = require('../controllers/ProfileController');
const { authenticate } = require('../middleware/auth');

router.get ('/', authenticate, getProfile);
router.patch('/', authenticate, updateProfile);

module.exports = router;