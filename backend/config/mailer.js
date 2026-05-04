/**
 * mailer.js — email helper for LifeHub
 *
 * Sends verification and password-reset emails.
 * Dev mode: logs links to console if SMTP is not configured.
 * Production: uses nodemailer with any SMTP provider.
 */

const isSmtpConfigured = () =>
  !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

function getBase() {
  // Verification links must go to the frontend, not the backend API server.
  // Use FRONTEND_URL if set, otherwise fall back to APP_BASE_URL for legacy compat.
  return (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
}

function getBackendBase() {
  return (process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
}

function getTransporter() {
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch {
    return null;
  }
  return nodemailer.createTransport({
    host:             process.env.SMTP_HOST,
    port:             parseInt(process.env.SMTP_PORT || '587', 10),
    secure:           process.env.SMTP_PORT === '465',
    auth:             { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,  // 10 s — prevents hanging on cold Render starts
    greetingTimeout:   5000,
    socketTimeout:    10000,
  });
}

async function sendVerificationEmail(toEmail, token) {
  // Verification clicks hit the backend API endpoint which then sets verified=true
  const link = `${getBackendBase()}/api/auth/verify-email?token=${token}`;

  if (!isSmtpConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email service not configured');
    }
    console.log('\n────────────────────────────────────────────────');
    console.log('📧  EMAIL VERIFICATION (dev mode — no SMTP configured)');
    console.log(`    To:   ${toEmail}`);
    console.log(`    Link: ${link}`);
    console.log('────────────────────────────────────────────────\n');
    return;
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[mailer] nodemailer not installed; falling back to console log.');
    console.log(`Verify link for ${toEmail}: ${link}`);
    return;
  }

  await transporter.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      toEmail,
    subject: 'Verify your LifeHub account',
    text:    `Click the link to verify your email:\n\n${link}\n\nExpires in 24 hours.`,
    html: `
      <p>Thanks for signing up for <strong>LifeHub</strong>!</p>
      <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Verify email address</a></p>
      <p style="color:#666;font-size:0.85em">Expires in 24 hours. Ignore if you didn't create this account.</p>
    `,
  });
}

async function sendPasswordResetEmail(toEmail, token) {
  const link = `${getBase()}/pages/reset-password.html?token=${token}`;

  if (!isSmtpConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email service not configured');
    }
    console.log('\n────────────────────────────────────────────────');
    console.log('🔑  PASSWORD RESET (dev mode — no SMTP configured)');
    console.log(`    To:   ${toEmail}`);
    console.log(`    Link: ${link}`);
    console.log('────────────────────────────────────────────────\n');
    return;
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('[mailer] nodemailer not installed; falling back to console log.');
    console.log(`Reset link for ${toEmail}: ${link}`);
    return;
  }

  await transporter.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to:      toEmail,
    subject: 'Reset your LifeHub password',
    text:    `Click the link to reset your password:\n\n${link}\n\nExpires in 1 hour. If you didn't request this, ignore this email.`,
    html: `
      <p>We received a request to reset your <strong>LifeHub</strong> password.</p>
      <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset password</a></p>
      <p style="color:#666;font-size:0.85em">Expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, isSmtpConfigured };