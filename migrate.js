'use strict';
/* ── migrate.js — runs before server.js on every deploy ───────────────────
   Safe to run multiple times. Exits 0 on success OR if column already exists.
   ────────────────────────────────────────────────────────────────────────── */
require('dotenv').config();
const db = require('./config/db');

async function run() {
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = 'products'
         AND COLUMN_NAME  = 'distributor_price'`
    );

    if (rows.length) {
      console.log('[migrate] distributor_price column already exists — skipping');
    } else {
      await db.query(
        `ALTER TABLE products
         ADD COLUMN distributor_price DECIMAL(10,2) NULL DEFAULT NULL`
      );
      console.log('[migrate] distributor_price column added ✓');
    }
  } catch (err) {
    console.error('[migrate] ERROR:', err.message);
    // Non-fatal — let server start anyway
  } finally {
    try { await db.end(); } catch (_) {}
    process.exit(0);
  }
}

run();
