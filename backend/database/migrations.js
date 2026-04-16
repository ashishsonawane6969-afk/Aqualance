'use strict';

/**
 * database/migrations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone migration steps that run on every server startup, after the core
 * schema is ensured by utils/ensureAuthTables.js.
 *
 * Each step is idempotent — safe to run repeatedly with no side effects when
 * the database is already up to date.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const db = require('../config/db');

let _done = false;

async function runMigrations() {
  if (_done) return;

  const DB_NAME = process.env.DB_NAME || 'aqualence_db';

  // ── Upgrade `image` column to LONGTEXT ──────────────────────────────────────
  // Allows storing large base64-encoded images (up to 4 GB).
  // VARCHAR(255) or TEXT columns silently truncate or throw ER_DATA_TOO_LONG
  // for any real photo encoded as a data URI. LONGTEXT removes that ceiling.
  // MODIFY COLUMN is safe on existing data — it only raises the type ceiling,
  // it never truncates or rewrites stored values.
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'image'`,
      [DB_NAME]
    );
    if (rows.length > 0 && !rows[0].COLUMN_TYPE.toLowerCase().includes('longtext')) {
      await db.query(
        `ALTER TABLE \`products\`
         MODIFY COLUMN \`image\` LONGTEXT DEFAULT NULL`
      );
      console.info('[migrations] ✓ Upgraded column products.image to LONGTEXT');
    }
  } catch (e) {
    console.warn('[migrations] ALTER products MODIFY image:', e.message);
  }

  _done = true;
  console.info('[migrations] ✓ All migration steps complete');
}

module.exports = { runMigrations };
