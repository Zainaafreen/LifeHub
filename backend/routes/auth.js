const express = require('express');
const router  = express.Router();
const {
  register,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  login,
  me,
  logout,
  changePassword,
  deleteAccount,
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const {
  validate,
  registerSchema,
  loginSchema,
  resendSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} = require('../config/validate');

// forgot-password gets its own tighter limiter (5 req/hr per IP)
// to prevent email flooding / account enumeration at scale.
// The limiter is attached to app.locals in server.js.
function getForgotLimiter(req, res, next) {
  const limiter = req.app.locals.forgotPasswordLimiter;
  return limiter ? limiter(req, res, next) : next();
}

router.post('/register',             validate(registerSchema),       register);
router.get ('/verify-email',                                         verifyEmail);
router.post('/resend-verification',  validate(resendSchema),         resendVerification);
router.post('/forgot-password',      getForgotLimiter, validate(forgotPasswordSchema), forgotPassword);
router.post('/reset-password',       validate(resetPasswordSchema),  resetPassword);
router.post('/login',                validate(loginSchema),          login);
router.get ('/me',                   authenticate,                   me);
router.post('/logout',               authenticate,                   logout);
router.patch('/change-password',     authenticate, validate(changePasswordSchema), changePassword);
router.delete('/account',            authenticate,                   deleteAccount);

module.exports = router;
