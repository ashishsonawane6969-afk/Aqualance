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

  // 1. Ensure products table image columns are LONGTEXT
  const productCols = ['image', 'image2', 'image3'];
  for (const col of productCols) {
    try {
      const [rows] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = ?`,
        [DB_NAME, col]
      );

      if (rows.length === 0) {
        // Column doesn't exist, add it
        await db.query(`ALTER TABLE \`products\` ADD COLUMN \`${col}\` LONGTEXT DEFAULT NULL`);
        console.info(`[migrations] ✓ Added column products.${col} as LONGTEXT`);
      } else {
        // Column exists, ensure it's LONGTEXT
        const [typeCheck] = await db.query(
          `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = ?`,
          [DB_NAME, col]
        );
        if (typeCheck.length > 0 && !typeCheck[0].COLUMN_TYPE.toLowerCase().includes('longtext')) {
          await db.query(`ALTER TABLE \`products\` MODIFY COLUMN \`${col}\` LONGTEXT DEFAULT NULL`);
          console.info(`[migrations] ✓ Upgraded column products.${col} to LONGTEXT`);
        }
      }
    } catch (e) {
      console.warn(`[migrations] Error handling products.${col}:`, e.message);
    }
  }

  // 2. Ensure distributor_price on products
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'distributor_price'`,
      [DB_NAME]
    );
    if (rows.length === 0) {
      await db.query(`ALTER TABLE \`products\` ADD COLUMN \`distributor_price\` DECIMAL(10,2) DEFAULT NULL AFTER \`mrp\``);
      console.info('[migrations] ✓ Added column products.distributor_price');
    }
  } catch (e) {
    console.warn('[migrations] Error handling products.distributor_price:', e.message);
  }

  // 3. Ensure product_variants table updates
  const variantUpdates = [
    { name: 'distributor_price', type: 'DECIMAL(10,2) DEFAULT NULL AFTER price' },
    { name: 'bundle_enabled', type: 'TINYINT(1) DEFAULT 0 AFTER stock' }
  ];

  for (const update of variantUpdates) {
    try {
      const [rows] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_variants' AND COLUMN_NAME = ?`,
        [DB_NAME, update.name]
      );
      if (rows.length === 0) {
        await db.query(`ALTER TABLE \`product_variants\` ADD COLUMN \`${update.name}\` ${update.type}`);
        console.info(`[migrations] ✓ Added column product_variants.${update.name}`);
      }
    } catch (e) {
      console.warn(`[migrations] Error handling product_variants.${update.name}:`, e.message);
    }
  }

  _done = true;
  console.info('[migrations] ✓ All migration steps complete');
}

module.exports = { runMigrations };
