/**
 * utils/ensureLeadProducts.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Auto-migration that runs on every server startup.
 *
 * Creates lead_products table and grand_total column if they don't exist.
 * Safe to call repeatedly — all statements are idempotent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const db = require('../config/db');

let _done = false;

async function ensureLeadProducts() {
  if (_done) return;

  // ── 1. Create lead_products table ──────────────────────────────────────────
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS lead_products (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        lead_id     INT            NOT NULL,
        product_id  INT            NOT NULL,
        name        VARCHAR(150)   NOT NULL DEFAULT '',
        price       DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
        quantity    INT            NOT NULL DEFAULT 1,
        total       DECIMAL(10,2)  NOT NULL DEFAULT 0.00,
        created_at  TIMESTAMP      DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (lead_id)    REFERENCES shop_leads(id)  ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)    ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) {
    // Table already exists — safe to ignore
    if (!e.message.includes('already exists') && e.code !== 'ER_TABLE_EXISTS_ERROR') {
      console.warn('[ensureLeadProducts] CREATE TABLE warning:', e.message);
    }
  }

  // ── 2. Add indexes (ignore if already exist) ───────────────────────────────
  for (const [idx, col] of [['idx_lp_lead', 'lead_id'], ['idx_lp_product', 'product_id']]) {
    try {
      await db.query(`CREATE INDEX ${idx} ON lead_products(${col})`);
    } catch (e) {
      // ER_DUP_KEYNAME = index already exists — safe to ignore
      if (e.code !== 'ER_DUP_KEYNAME' && !e.message.includes('Duplicate key name')) {
        console.warn(`[ensureLeadProducts] index ${idx} warning:`, e.message);
      }
    }
  }

  // ── 3. Add grand_total column to shop_leads ────────────────────────────────
  try {
    await db.query(
      `ALTER TABLE shop_leads ADD COLUMN grand_total DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER sale_status`
    );
  } catch (e) {
    // ER_DUP_FIELDNAME = column already exists — safe to ignore
    if (e.code !== 'ER_DUP_FIELDNAME' && !e.message.includes('Duplicate column')) {
      console.warn('[ensureLeadProducts] grand_total column warning:', e.message);
    }
  }

  _done = true;
}

module.exports = { ensureLeadProducts };
