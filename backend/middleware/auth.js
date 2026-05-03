const jwt    = require('jsonwebtoken');
const pool   = require('../config/db');
const logger = require('../config/logger');

// ── revokeToken ───────────────────────────────────────────────────────────────
// Inserts the token's JTI + expiry into revoked_tokens.
// Called by authController on logout.
async function revokeToken(token) {
  try {
    const decoded = jwt.decode(token);
    if (!decoded?.jti || !decoded?.exp) return;

    // exp is UNIX seconds → convert to Postgres TIMESTAMPTZ
    await pool.query(
      `INSERT INTO revoked_tokens (jti, expires_at)
       VALUES ($1, to_timestamp($2))
       ON CONFLICT (jti) DO NOTHING`,
      [decoded.jti, decoded.exp]
    );
  } catch (err) {
    logger.error({ err }, 'revokeToken DB error');
  }
}

// ── isRevoked ─────────────────────────────────────────────────────────────────
// Returns true if the JTI exists in the DB and hasn't expired yet.
async function isRevoked(jti) {
  if (!jti) return false;
  try {
    const result = await pool.query(
      `SELECT 1 FROM revoked_tokens
       WHERE jti = $1 AND expires_at > NOW()
       LIMIT 1`,
      [jti]
    );
    return result.rows.length > 0;
  } catch (err) {
    // ── Fail-open trade-off ────────────────────────────────────────────────
    // If the DB is unreachable we return false (token not revoked) rather
    // than true (token revoked) or throwing.
    //
    // Consequence: during a DB outage a user who has already logged out may
    // continue to make authenticated requests until their JWT naturally
    // expires (default: 7 days) or the DB recovers.
    //
    // Alternative (fail-closed): return true here.  Safer, but it logs
    // everyone out whenever the DB hiccups — a poor UX trade-off for most
    // apps.  For high-security deployments (admin portals, financial data)
    // flip this to `return true` and document it for ops.
    //
    // Mitigation already in place: JWTs have a short-lived expiry and the
    // revoked_tokens table is cleaned up hourly.  Network-level DB HA
    // (multi-AZ, read replicas) is the primary defence against outages.
    logger.error({ err }, 'isRevoked DB error — failing open (token not revoked)');
    return false;
  }
}

// ── authenticate ──────────────────────────────────────────────────────────────
// Reads the JWT from the httpOnly cookie lh_token.
// Falls back to Authorization header so existing API clients keep working.
async function authenticate(req, res, next) {
  const cookieToken = req.cookies?.lh_token;
  const headerToken = (() => {
    const h = req.headers['authorization'];
    if (!h) return null;
    return h.startsWith('Bearer ') ? h.slice(7) : h;
  })();

  const token = cookieToken || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.jti && await isRevoked(decoded.jti)) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    req.userId = decoded.userId;
    req.token  = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate, revokeToken };
