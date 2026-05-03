/**
 * rateLimitStore.js — PostgreSQL-backed store for express-rate-limit
 *
 * Replaces the default in-memory store so:
 *   • Counters survive server restarts / container redeployments
 *   • Multiple server instances share the same counters
 *
 * No Redis, no new npm packages — uses the existing `pg` pool.
 *
 * express-rate-limit store contract:
 *   init(options)              called once with the limiter's options
 *   increment(key)             → { totalHits, resetTime }
 *   decrement(key)             called on successful responses (optional)
 *   resetKey(key)              wipe a single key
 *   resetAll()                 wipe everything (optional)
 */

const pool = require('./db');

class PgRateLimitStore {
  /**
   * @param {string} prefix   Differentiates separate limiters in the same table.
   *                          e.g. 'api' vs 'auth'
   */
  constructor(prefix = 'rl') {
    this.prefix     = prefix;
    this.windowMs   = null; // set by init()
  }

  // Called by express-rate-limit after construction
  init(options) {
    this.windowMs = options.windowMs;
  }

  // Returns the start of the current window (truncated to window boundaries)
  _windowEnd(now = Date.now()) {
    const windowMs  = this.windowMs;
    const windowEnd = new Date(Math.ceil(now / windowMs) * windowMs);
    return windowEnd;
  }

  _key(rawKey) {
    return `${this.prefix}:${rawKey}`;
  }

  async increment(rawKey) {
    const key       = this._key(rawKey);
    const windowEnd = this._windowEnd();

    try {
      const result = await pool.query(
        `INSERT INTO rate_limit_hits (key, window_end, hits)
         VALUES ($1, $2, 1)
         ON CONFLICT (key, window_end)
         DO UPDATE SET hits = rate_limit_hits.hits + 1
         RETURNING hits`,
        [key, windowEnd]
      );

      return {
        totalHits: result.rows[0].hits,
        resetTime: windowEnd,
      };
    } catch (err) {
      // Fail open: if the DB is down, don't block legitimate requests
      console.error('[RateLimitStore] increment error:', err.message);
      return { totalHits: 1, resetTime: this._windowEnd() };
    }
  }

  async decrement(rawKey) {
    const key       = this._key(rawKey);
    const windowEnd = this._windowEnd();
    try {
      await pool.query(
        `UPDATE rate_limit_hits
         SET hits = GREATEST(hits - 1, 0)
         WHERE key = $1 AND window_end = $2`,
        [key, windowEnd]
      );
    } catch (err) {
      console.error('[RateLimitStore] decrement error:', err.message);
    }
  }

  async resetKey(rawKey) {
    const key = this._key(rawKey);
    try {
      await pool.query(
        'DELETE FROM rate_limit_hits WHERE key = $1',
        [key]
      );
    } catch (err) {
      console.error('[RateLimitStore] resetKey error:', err.message);
    }
  }

  async resetAll() {
    try {
      await pool.query(
        "DELETE FROM rate_limit_hits WHERE key LIKE $1",
        [`${this.prefix}:%`]
      );
    } catch (err) {
      console.error('[RateLimitStore] resetAll error:', err.message);
    }
  }
}

module.exports = PgRateLimitStore;
