const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// ── Connection config ─────────────────────────────────────────
// Accepts either a single DATABASE_URL (Render, Railway, Neon, Supabase)
// or individual DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD vars
// (local development, bare VPS).  DATABASE_URL takes precedence when both
// are present so platform-injected values always win.
const connectionConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host:     process.env.DB_HOST     || 'localhost',
      port:     parseInt(process.env.DB_PORT || '5432', 10),
      database: process.env.DB_NAME     || 'lifehub',
      user:     process.env.DB_USER     || 'postgres',
      password: process.env.DB_PASSWORD || '',
    };

// ── Fix: validate SSL config before creating the pool ─────────
// Neon / Supabase / Railway ship their own CA bundle.  If you are using
// a DATABASE_URL from one of those providers the server's CA is already
// trusted by Node's built-in root store, so DB_SSL_CA is optional.
// For any other host that uses a self-signed cert you MUST supply
// DB_SSL_CA (path to the PEM file) — otherwise `rejectUnauthorized: true`
// will throw "self-signed certificate" and every query will fail.
//
// Set DB_SSL_CA to the path of the CA PEM file, e.g.:
//   DB_SSL_CA=/etc/ssl/certs/my-db-ca.pem
// Or, if your provider's CA is in Node's trust store, leave it unset.
let sslConfig;
if (isProduction) {
  if (process.env.DB_SSL_CA) {
    // Resolve relative to the project root so it works regardless of cwd
    const caPath = path.isAbsolute(process.env.DB_SSL_CA)
      ? process.env.DB_SSL_CA
      : path.resolve(__dirname, '..', process.env.DB_SSL_CA);
    try {
      sslConfig = {
        rejectUnauthorized: true,
        ca: fs.readFileSync(caPath).toString(),
      };
    } catch (e) {
      console.warn(`⚠️  Could not read DB_SSL_CA at ${caPath}: ${e.message}. Falling back to system trust store.`);
      sslConfig = { rejectUnauthorized: true };
    }
  } else {
    // No custom CA supplied — rely on Node's built-in root store.
    sslConfig = { rejectUnauthorized: true };
    console.warn(
      '⚠️  DB_SSL_CA is not set.  SSL connections will be accepted only if ' +
      'the server certificate is signed by a publicly trusted CA.  ' +
      'Set DB_SSL_CA to the path of your CA PEM file if you use a self-signed cert.'
    );
  }
} else {
  sslConfig = { rejectUnauthorized: false };
}

const pool = new Pool({
  ...connectionConfig,
  ssl: sslConfig,

  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let logged = false;

pool.on('connect', () => {
  if (!logged && process.env.NODE_ENV !== 'test') {
    console.log('✅ Connected to PostgreSQL');
    logged = true;
  }
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err.message);
});

module.exports = pool;