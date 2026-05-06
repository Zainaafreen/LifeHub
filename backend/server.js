const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const crypto       = require('crypto');
const path         = require('path');
require('dotenv').config();
const logger = require('./config/logger');
const pool   = require('./config/db');
const profileRouter = require('./routes/profile');
const { startReminderScheduler, stopReminderScheduler } = require('./reminderScheduler');

// ── Required env vars ─────────────────────────────────────────
const REQUIRED_ENV = ['JWT_SECRET', 'DATABASE_URL'];
const missingEnv   = REQUIRED_ENV.filter(v => !process.env[v]);
if (missingEnv.length > 0) {
  logger.fatal({ missing: missingEnv }, 'Required env vars not set — refusing to start');
  process.exit(1);
}

const DEFAULT_JWT = 'your_super_secret_jwt_key_change_this_in_production';
if (process.env.JWT_SECRET === DEFAULT_JWT) {
  logger.fatal('JWT_SECRET is still the default placeholder — refusing to start');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production') {
  const smtpVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const missing  = smtpVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    logger.warn(
      { missing },
      'SMTP is not fully configured — email verification and password-reset will return errors.'
    );
    // Do NOT exit: app starts normally; email routes return a clear error.
  }
}

const app = express();

// ── HTTPS redirect ────────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// ── requestId middleware ──────────────────────────────────────
// Attach a unique ID to every request; expose it in the response header
// so distributed traces can correlate client errors with server logs.
app.use((req, _res, next) => {
  req.id = crypto.randomUUID();
  next();
});

// Attach requestId to every response
app.use((req, res, next) => {
  res.setHeader('X-Request-Id', req.id);
  next();
});

// ── Security headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:     ["'self'", "https://fonts.gstatic.com"],
      imgSrc:      ["'self'", "data:"],
      connectSrc:  [
        "'self'",
        'https://lifehub-backend-n0y5.onrender.com', // ← add backend URL here
        'https://fcm.googleapis.com',        // ← ADD THIS
        'https://*.googleapis.com',
      ],
    },
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

// ── Secure CORS ───────────────────────────────────────────────
// Whitelist-only: explicit origin (no wildcard fallback).
// Rejects requests from unlisted origins with a CORS error rather than
// silently stripping credentials.
const allowedOrigins = (process.env.ALLOWED_ORIGIN || 'http://localhost:5000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / server-to-server requests (no Origin header)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// ── Body / cookie parsing ─────────────────────────────────────
app.use(cookieParser());
app.use(express.json({ limit: '50kb' }));

// ── Content-Type enforcement for API routes ───────────────────
app.use('/api', (req, res, next) => {
  const bodyMethods = ['POST', 'PUT', 'PATCH'];
  const hasBody = (req.headers['content-length'] && req.headers['content-length'] !== '0')
               || req.headers['transfer-encoding'];
  if (bodyMethods.includes(req.method) && hasBody && !req.is('application/json')) {
    return res.status(415).json({
      error: 'Unsupported Media Type — Content-Type must be application/json',
    });
  }
  next();
});

// ── CSRF ──────────────────────────────────────────────────────
const CSRF_COOKIE = 'lh_csrf';
const CSRF_HEADER = 'x-csrf-token';
const CSRF_EXEMPT = new Set([
  '/healthz',
  '/health',
  '/api/health',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/resend-verification',
  '/api/auth/verify-email',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/csrf-token',
]);

function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

function csrfCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: false,   // must be readable by JS to echo back
    sameSite: isProd ? 'none' : 'lax',
    secure:   isProd,
    path:     '/',
  };
}

app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'test') return next();
  if (
    req.method === 'GET'  ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS' ||
    CSRF_EXEMPT.has(req.path)
  ) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.headers[CSRF_HEADER];

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  try {
    const a = Buffer.from(cookieToken, 'utf8');
    const b = Buffer.from(headerToken, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
});

// ── Rate limiters ─────────────────────────────────────────────
const PgRateLimitStore = require('./config/rateLimitStore');

// Tighter limiter for login + forgot-password endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many attempts, please try again later.' },
  store:   new PgRateLimitStore('auth'),
  keyGenerator: (req) => req.ip,
  skip: () => process.env.NODE_ENV === 'development',  // ← add this line
});

// Separate, slightly tighter limiter for forgot-password
const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many password-reset requests. Try again in an hour.' },
  store:   new PgRateLimitStore('forgot-password'),
  keyGenerator: (req) => req.ip,
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      300,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please slow down.' },
  // Skip health-threshold endpoint AND all auth routes (auth has its own limiter)
  skip:  (req) => req.path === '/api/health/thresholds' || req.path.startsWith('/api/auth'),
  store: new PgRateLimitStore('api'),
});

// Export limiters so routes can reference them
app.locals.forgotPasswordLimiter = forgotPasswordLimiter;

// ── Static frontend ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../frontend')));

// ── Health check endpoints ────────────────────────────────────
// /healthz — Docker/k8s liveness probe (no rate limit, no auth)
// GET /health — alias used by some load balancers / monitoring tools
async function healthHandler(req, res) {
  const reqLog = logger.forRequest(req.id);
  const health = { status: 'ok', uptime: process.uptime(), ts: Date.now(), db: 'ok' };
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    health.status = 'degraded';
    health.db     = 'unreachable';
    reqLog.error({ err }, 'Health check: DB unreachable');
    return res.status(503).json(health);
  }
  res.json(health);
}

app.get('/healthz', healthHandler);
app.get('/health',  healthHandler);   // ← GET /health added

// ── GET /api/csrf-token ───────────────────────────────────────
app.get('/api/csrf-token', (req, res) => {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
  res.json({ csrfToken: token });
});

// ── POST /api/client-errors ───────────────────────────────────
// Enriched with userId (from JWT if present), route, userAgent, requestId.
const clientErrorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new PgRateLimitStore('client-errors'),
});

app.post('/api/client-errors', clientErrorLimiter, (req, res) => {
  // sendBeacon sends Content-Type: text/plain — read raw body
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try {
      const entry = JSON.parse(raw);

      // Enrich with server-side context the client cannot forge
      const enriched = {
        ...entry,
        requestId: req.id,
        userAgent: req.headers['user-agent'] || null,
        route:     entry.route || req.headers['referer'] || null,
        // Decode userId from JWT cookie without full auth middleware
        userId: (() => {
          try {
            const jwt = require('jsonwebtoken');
            const token = req.cookies?.lh_token;
            if (!token) return entry.userId || null;
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            return decoded?.userId ?? null;
          } catch {
            return entry.userId || null;
          }
        })(),
        ip: req.ip,
        ts: new Date().toISOString(),
      };

      logger.warn({ clientError: enriched }, 'Frontend JS error');
    } catch {
      logger.warn({ rawBody: raw.slice(0, 500), requestId: req.id }, 'Unparseable client-error report');
    }
    res.status(204).end();
  });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/auth',      authLimiter, require('./routes/auth'));  // authLimiter only — apiLimiter skips /api/auth
app.use('/api/profile',   apiLimiter, profileRouter);
app.use('/api/tasks',     apiLimiter, require('./routes/tasks'));
app.use('/api/expenses',  apiLimiter, require('./routes/expenses'));
app.use('/api/health',    apiLimiter, require('./routes/health'));
app.use('/api/reminders', apiLimiter, require('./routes/reminders'));
app.use('/api/dashboard', apiLimiter, require('./routes/dashboard'));
app.use('/api/push',      apiLimiter, require('./routes/push'));

// ── Catch-all: serve frontend ─────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  const reqLog = logger.forRequest(req.id);
  reqLog.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error', requestId: req.id });
});

// ── DB cleanup scheduler ──────────────────────────────────────
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function runDbCleanup() {
  try {
    await pool.query('SELECT cleanup_expired_rows()');
    logger.debug('DB cleanup completed');
  } catch (err) {
    logger.error({ err }, 'DB cleanup error');
  }
}

let _cleanupInterval = null;
function startCleanupScheduler() {
  setTimeout(async () => {
    await runDbCleanup();
    _cleanupInterval = setInterval(runDbCleanup, CLEANUP_INTERVAL_MS);
  }, 60_000);
}

// ── Start ─────────────────────────────────────────────────────
const PORT   = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, 'LifeHub server started');
  startCleanupScheduler();
  startReminderScheduler();
});

// ── Graceful shutdown ─────────────────────────────────────────
async function shutdown(signal) {
  logger.info({ signal }, 'Shutting down gracefully');
  if (_cleanupInterval) clearInterval(_cleanupInterval);
  stopReminderScheduler();
  server.close(async () => {
    try {
      await pool.end();
      logger.info('DB pool closed');
    } catch (err) {
      logger.error({ err }, 'DB close error');
    }
    logger.info('Server shut down');
    process.exit(0);
  });
  setTimeout(() => { logger.error('Forced exit after timeout'); process.exit(1); }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;