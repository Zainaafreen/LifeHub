/**
 * mailer.js — email helper for LifeHub
 *
 * Send strategy (tried in order):
 *   1. Resend  — if RESEND_API_KEY is set  (HTTPS API, works on Render free tier)
 *   2. SMTP    — if SMTP_HOST + SMTP_USER + SMTP_PASS are set  (blocked on Render free tier)
 *   3. Dev log — if NODE_ENV !== 'production'  (prints link to console)
 *   4. Throw   — production with no provider configured
 *
 * Recommended for Render free tier: use Resend (https://resend.com).
 * Sign up → create an API key → set RESEND_API_KEY + RESEND_FROM env vars.
 */

// ── Provider detection ────────────────────────────────────────

const isResendConfigured = () => !!process.env.RESEND_API_KEY;

const isSmtpConfigured = () =>
  !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const isEmailConfigured = () => isResendConfigured() || isSmtpConfigured();

// ── URL helpers ───────────────────────────────────────────────

function getBase() {
  return (process.env.FRONTEND_URL || process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
}

function getBackendBase() {
  return (process.env.APP_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
}

// ── Resend sender (HTTPS — works on Render free tier) ─────────

async function sendViaResend({ to, subject, text, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    process.env.RESEND_FROM || 'LifeHub <onboarding@resend.dev>',
      to:      [to],
      subject,
      text,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

// ── SMTP sender (nodemailer — blocked on Render free tier) ────

function getSmtpTransporter() {
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch {
    return null;
  }
  return nodemailer.createTransport({
    host:              process.env.SMTP_HOST,
    port:              parseInt(process.env.SMTP_PORT || '587', 10),
    secure:            process.env.SMTP_PORT === '465',
    auth:              { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout:   5000,
    socketTimeout:     10000,
  });
}

async function sendViaSmtp({ to, subject, text, html }) {
  const transporter = getSmtpTransporter();
  if (!transporter) throw new Error('nodemailer not installed');
  await transporter.sendMail({
    from:    process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}

// ── Unified send ──────────────────────────────────────────────

async function sendEmail(opts) {
  if (isResendConfigured()) {
    return sendViaResend(opts);
  }
  if (isSmtpConfigured()) {
    return sendViaSmtp(opts);
  }
  if (process.env.NODE_ENV !== 'production') {
    // Dev fallback — print to console so the link is usable without any email setup
    console.log('\n────────────────────────────────────────────────');
    console.log(`📧  EMAIL (dev mode — no provider configured)`);
    console.log(`    To:      ${opts.to}`);
    console.log(`    Subject: ${opts.subject}`);
    console.log(`    Link:    ${opts._devLink || '(see html/text)'}`);
    console.log('────────────────────────────────────────────────\n');
    return;
  }
  throw new Error('Email service not configured');
}

// ── Public API ────────────────────────────────────────────────

async function sendVerificationEmail(toEmail, token) {
  const link = `${getBackendBase()}/api/auth/verify-email?token=${token}`;
  await sendEmail({
    to:       toEmail,
    subject:  'Verify your LifeHub account',
    text:     `Click the link to verify your email:\n\n${link}\n\nExpires in 24 hours.`,
    html:     `
      <p>Thanks for signing up for <strong>LifeHub</strong>!</p>
      <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Verify email address</a></p>
      <p style="color:#666;font-size:0.85em">Expires in 24 hours. Ignore if you didn't create this account.</p>
    `,
    _devLink: link,
  });
}

async function sendPasswordResetEmail(toEmail, token) {
  const link = `${getBase()}/pages/reset-password.html?token=${token}`;
  await sendEmail({
    to:       toEmail,
    subject:  'Reset your LifeHub password',
    text:     `Click the link to reset your password:\n\n${link}\n\nExpires in 1 hour. If you didn't request this, ignore this email.`,
    html:     `
      <p>We received a request to reset your <strong>LifeHub</strong> password.</p>
      <p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Reset password</a></p>
      <p style="color:#666;font-size:0.85em">Expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
    `,
    _devLink: link,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, isSmtpConfigured, isEmailConfigured };