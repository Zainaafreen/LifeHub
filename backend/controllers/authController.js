const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool    = require('../config/db');
const logger  = require('../config/logger');
const { revokeToken }             = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../config/mailer');

// ── Cookie settings ──────────────────────────────────────────
// Frontend and backend are deployed on different Render origins, so the
// auth cookie must be allowed in cross-site requests. Using SameSite=Strict
// causes login to "succeed" and then /api/auth/me immediately returns 401
// because the browser will not send the cookie back on frontend → backend
// fetches.
const TOKEN_EXPIRY_SECS = 2 * 24 * 60 * 60; // 2 days
function cookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure:   isProd,
    maxAge:   TOKEN_EXPIRY_SECS * 1000,
    path:     '/',
  };
}

function clearCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure:   isProd,
    path:     '/',
  };
}

// ── POST /api/auth/register ──────────────────────────────────
// Body validated upstream by Zod registerSchema via validate() middleware.
async function register(req, res) {
  try {
    const reqLog = logger.forRequest(req.id);
    const { name, email, password } = req.body;

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (name, email, password, verified) VALUES ($1, $2, $3, FALSE) RETURNING id, name, email',
      [name, email, hashed]
    );

    const user = result.rows[0];

    const rawToken  = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      'INSERT INTO email_verify_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [rawToken, user.id, expiresAt]
    );

    let emailSent = true;
    try {
      await sendVerificationEmail(user.email, rawToken);
    } catch (emailErr) {
      emailSent = false;
      reqLog.warn({ err: emailErr }, 'Verification email failed to send — account created but email not sent');
    }

    reqLog.info({ userId: user.id }, 'User registered');

    const response = {
      message: emailSent
        ? 'Account created. Please check your email to verify your address before logging in.'
        : 'Account created, but we could not send a verification email right now. Use the "Resend verification" option on the login page.',
      user: { id: user.id, name: user.name, email: user.email },
    };
    if (!process.env.SMTP_HOST) {
      response.devVerifyToken = rawToken;
      response.devNote = 'SMTP not configured — use this token to verify: GET /api/auth/verify-email?token=<devVerifyToken>';
    }

    res.status(201).json(response);
  } catch (err) {
    reqLog.error({ err }, 'Register error');
    res.status(500).json({ error: 'Server error during registration' });
  }
}

// ── GET /api/auth/verify-email?token=<hex> ───────────────────
async function verifyEmail(req, res) {
  const reqLog = logger.forRequest(req.id);
  try {
    const { token } = req.query;

    if (!token || !/^[0-9a-f]{64}$/.test(token)) {
      const frontendBase = (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
      return res.redirect(`${frontendBase}/pages/verify-status.html?status=expired`);
    }

    const result = await pool.query(
      `SELECT evt.user_id, u.name, u.email, u.verified
       FROM   email_verify_tokens evt
       JOIN   users u ON u.id = evt.user_id
       WHERE  evt.token     = $1
         AND  evt.used      = FALSE
         AND  evt.expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      const frontendBase = (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
      return res.redirect(`${frontendBase}/pages/verify-status.html?status=expired`);
    }

    const row = result.rows[0];

    if (row.verified) {
      const frontendBase = (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
      return res.redirect(`${frontendBase}/pages/verify-status.html?status=already`);
    }

    await pool.query('BEGIN');
    await pool.query('UPDATE users SET verified = TRUE WHERE id = $1',              [row.user_id]);
    await pool.query('UPDATE email_verify_tokens SET used = TRUE WHERE token = $1', [token]);
    await pool.query('COMMIT');

    reqLog.info({ userId: row.user_id }, 'Email verified');

    const frontendBase = (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
    return res.redirect(`${frontendBase}/pages/login.html?verified=1`);
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    reqLog.error({ err }, 'verifyEmail error');
    res.status(500).json({ error: 'Server error during verification' });
  }
}

// ── POST /api/auth/resend-verification ───────────────────────
async function resendVerification(req, res) {
  const reqLog = logger.forRequest(req.id);
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const result = await pool.query(
      'SELECT id, name, email, verified FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0 || result.rows[0].verified) {
      return res.json({ message: 'If that email exists and is unverified, a new link has been sent.' });
    }

    const user = result.rows[0];

    await pool.query(
      'UPDATE email_verify_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE',
      [user.id]
    );

    const rawToken  = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      'INSERT INTO email_verify_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [rawToken, user.id, expiresAt]
    );

    await sendVerificationEmail(user.email, rawToken);

    res.json({ message: 'If that email exists and is unverified, a new link has been sent.' });
  } catch (err) {
    reqLog.error({ err }, 'resendVerification error');
    res.status(500).json({ error: 'Server error' });
  }
}

// ── POST /api/auth/forgot-password ───────────────────────────
async function forgotPassword(req, res) {
  const reqLog = logger.forRequest(req.id);
  try {
    const { email } = req.body;

    const result = await pool.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email]
    );

    const genericOk = { message: 'If that email is registered, a password reset link has been sent.' };

    if (result.rows.length === 0) {
      return res.json(genericOk);
    }

    const user = result.rows[0];

    await pool.query(
      'UPDATE password_reset_tokens SET used = TRUE WHERE user_id = $1 AND used = FALSE',
      [user.id]
    );

    const rawToken  = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      'INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES ($1, $2, $3)',
      [rawToken, user.id, expiresAt]
    );

    try {
      await sendPasswordResetEmail(user.email, rawToken);
    } catch (emailErr) {
      if (emailErr.message === 'Email service not configured') {
        return res.status(503).json({ error: 'Email service not configured. Contact your administrator.' });
      }
      throw emailErr;
    }

    reqLog.info({ userId: user.id }, 'Password reset requested');
    res.json(genericOk);
  } catch (err) {
    console.error('forgotPassword error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

// ── POST /api/auth/reset-password ────────────────────────────
async function resetPassword(req, res) {
  const reqLog = logger.forRequest(req.id);
  try {
    const { token, password } = req.body;

    const result = await pool.query(
      `SELECT prt.user_id
       FROM   password_reset_tokens prt
       WHERE  prt.token      = $1
         AND  prt.used       = FALSE
         AND  prt.expires_at > NOW()`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired' });
    }

    const { user_id } = result.rows[0];
    const hashed = await bcrypt.hash(password, 10);

    await pool.query('BEGIN');
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, user_id]);
    await pool.query('UPDATE password_reset_tokens SET used = TRUE WHERE token = $1', [token]);
    await pool.query('COMMIT');

    reqLog.info({ userId: user_id }, 'Password reset successfully');
    res.json({ message: 'Password reset successfully. You can now log in with your new password.' });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    reqLog.error({ err }, 'resetPassword error');
    res.status(500).json({ error: 'Server error during password reset' });
  }
}

// ── POST /api/auth/login ─────────────────────────────────────
async function login(req, res) {
  try {
    const reqLog = logger.forRequest(req.id);
    const { email, password } = req.body;

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user  = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (!user.verified) {
      return res.status(403).json({
        error: 'Please verify your email address before logging in.',
        code:  'EMAIL_NOT_VERIFIED',
      });
    }

    const token = jwt.sign(
      { userId: user.id, jti: uuidv4() },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY_SECS }
    );

    res.cookie('lh_token', token, cookieOptions());
    reqLog.info({ userId: user.id }, 'User logged in');
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    reqLog.error({ err }, 'Login error');
    res.status(500).json({ error: 'Server error during login' });
  }
}

// ── GET /api/auth/me ─────────────────────────────────────────
async function me(req, res) {
  const reqLog = logger.forRequest(req.id);
  try {
    const result = await pool.query(
      'SELECT id, name, email, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    reqLog.error({ err }, 'Me error');
    res.status(500).json({ error: 'Server error' });
  }
}

// ── POST /api/auth/logout ────────────────────────────────────
async function logout(req, res) {
  const reqLog = logger.forRequest(req.id);
  try {
    if (req.token) await revokeToken(req.token);
    res.clearCookie('lh_token', clearCookieOptions());
    reqLog.info({ userId: req.userId }, 'User logged out');
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    reqLog.error({ err }, 'Logout error');
    res.status(500).json({ error: 'Server error during logout' });
  }
}

// ── PATCH /api/auth/change-password ──────────────────────────
async function changePassword(req, res) {
  try {
    const reqLog = logger.forRequest(req.id);
    const { currentPassword, newPassword } = req.body;

    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const match = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!match) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.userId]);

    reqLog.info({ userId: req.userId }, 'Password changed');
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    const reqLog = logger.forRequest(req.id);
    reqLog.error({ err }, 'changePassword error');
    res.status(500).json({ error: 'Server error' });
  }
}

// ── DELETE /api/auth/account ──────────────────────────────────
async function deleteAccount(req, res) {
  try {
    const reqLog = logger.forRequest(req.id);

    if (req.token) await revokeToken(req.token).catch(() => {});

    await pool.query('DELETE FROM users WHERE id = $1', [req.userId]);

    res.clearCookie('lh_token', clearCookieOptions());
    reqLog.info({ userId: req.userId }, 'Account deleted');
    res.json({ message: 'Account deleted successfully' });
  } catch (err) {
    const reqLog = logger.forRequest(req.id);
    reqLog.error({ err }, 'deleteAccount error');
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { register, verifyEmail, resendVerification, forgotPassword, resetPassword, login, me, logout, changePassword, deleteAccount };