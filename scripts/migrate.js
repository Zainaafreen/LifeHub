#!/usr/bin/env node
/**
 * migrate.js — lightweight SQL migration runner for LifeHub
 *
 * Usage:
 *   node migrate.js              # apply all pending migrations
 *   node migrate.js --status     # list applied / pending migrations
 *
 * Migrations live in ../migrations/ (relative to this file).
 * Filenames must match: NNNN_description.sql   (e.g. 0002_add_avatar.sql)
 * They are applied in ascending numeric order.
 *
 * Each migration runs in its own transaction.  If a migration throws,
 * the transaction is rolled back and the process exits with code 1.
 *
 * The schema_migrations table is created automatically on first run
 * (see 0001_baseline.sql, which also creates it via IF NOT EXISTS so
 * bootstrapping works even on a completely empty database).
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

const { Client } = require('pg');
const fs         = require('fs');
const path       = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

async function run() {
  const showStatus = process.argv.includes('--status');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Ensure the bookkeeping table exists (safe to run on a fresh DB)
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(10)  PRIMARY KEY,
      name       TEXT         NOT NULL,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);

  // Fetch already-applied versions
  const { rows: applied } = await client.query(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  const appliedVersions = new Set(applied.map(r => r.version));

  // Discover migration files
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  if (showStatus) {
    console.log('\n Migration status\n');
    console.log(' Version  Status    File');
    console.log(' ───────  ────────  ────────────────────────────────────');
    for (const f of files) {
      const version = f.slice(0, 4);
      const status  = appliedVersions.has(version) ? '✅ applied' : '⏳ pending';
      console.log(` ${version}     ${status.padEnd(9)} ${f}`);
    }
    console.log();
    await client.end();
    return;
  }

  const pending = files.filter(f => !appliedVersions.has(f.slice(0, 4)));

  if (pending.length === 0) {
    console.log('✅  No pending migrations — database is up to date.');
    await client.end();
    return;
  }

  for (const file of pending) {
    const version = file.slice(0, 4);
    const name    = file.slice(5).replace(/\.sql$/, '');
    const sql     = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    console.log(`⏩  Applying ${file} …`);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      // Record it (migration SQL may already INSERT, so ON CONFLICT is safe)
      await client.query(
        `INSERT INTO schema_migrations (version, name)
         VALUES ($1, $2)
         ON CONFLICT (version) DO NOTHING`,
        [version, name]
      );
      await client.query('COMMIT');
      console.log(`✅  Applied  ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`❌  Failed   ${file}`);
      console.error(err.message);
      await client.end();
      process.exit(1);
    }
  }

  console.log(`\n✅  ${pending.length} migration(s) applied successfully.\n`);
  await client.end();
}

run().catch(err => {
  console.error('Migration runner error:', err);
  process.exit(1);
});
