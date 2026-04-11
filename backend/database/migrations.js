/**
 * database/migrations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Schema migration runner for product variants and bundle support.
 *
 * WHAT THIS DOES:
 *   1. Adds `product_type` column to `products`  (single | jar | strip)
 *   2. Adds `display_name` column to `products`  (marketing-friendly label)
 *   3. Creates `product_variants` table           (size/pack variants per product)
 *   4. Creates `bundle_items` table               (products that contain other products)
 *   5. Adds `variant_id` column to `order_items`  (links line-items to a specific variant)
 *
 * IDEMPOTENCY:
 *   Every statement uses IF NOT EXISTS or an INFORMATION_SCHEMA pre-check so
 *   this migration is safe to re-run on every server startup without side-effects.
 *
 * USAGE:
 *   Called automatically from server.js after connectDB() and ensureAuthTables().
 *   Can also be run manually:
 *     node -e "require('./database/migrations').runMigrations()"
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const db = require('../config/db');

/**
 * Run all schema migrations for variant and bundle support.
 * @returns {Promise<void>}
 */
async function runMigrations() {
  const DB_NAME = process.env.DB_NAME || 'aqualence_db';

  console.info('[migrations] Running schema migrations…');

  // ── 0. Disable FK checks for the duration of DDL ─────────────────────────
  // Allows creating tables with FK references in any order and avoids
  // "Cannot add foreign key constraint" errors during CREATE TABLE IF NOT EXISTS.
  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
  } catch (e) {
    console.warn('[migrations] SET FOREIGN_KEY_CHECKS=0 warning:', e.message);
  }

  // ── 1. Add `product_type` to `products` ───────────────────────────────────
  // Classifies a product as a single unit, jar, or strip.
  // ENUM default 'single' keeps existing rows valid without a data migration.
  try {
    const [rows] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'product_type'`,
      [DB_NAME]
    );
    if (rows.length === 0) {
      await db.query(
        `ALTER TABLE \`products\`
         ADD COLUMN \`product_type\` ENUM('single','jar','strip') NOT NULL DEFAULT 'single'`
      );
      console.info('[migrations] ✓ Added column products.product_type');
    }
  } catch (e) {
    console.warn('[migrations] ALTER products ADD product_type:', e.message);
  }

  // ── 2. Add `display_name` to `products` ───────────────────────────────────
  // Human-readable / marketing name shown in the UI (e.g. "Aqualence 20L Jar").
  // Already handled by ensureAuthTables, but we guard with INFORMATION_SCHEMA
  // so this migration is fully self-contained and safe to run standalone.
  try {
    const [rows] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'display_name'`,
      [DB_NAME]
    );
    if (rows.length === 0) {
      await db.query(
        `ALTER TABLE \`products\`
         ADD COLUMN \`display_name\` VARCHAR(255) DEFAULT NULL`
      );
      console.info('[migrations] ✓ Added column products.display_name');
    }
  } catch (e) {
    console.warn('[migrations] ALTER products ADD display_name:', e.message);
  }

  // ── 3. Create `product_variants` table ────────────────────────────────────
  // Each row is one purchasable variant of a parent product
  // (e.g. "500 ml bottle × 12-pack" or "20 L jar × 1").
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS product_variants (
        id            INT              NOT NULL AUTO_INCREMENT,
        product_id    INT              NOT NULL,
        variant_name  VARCHAR(150)     NOT NULL,
        size_value    DECIMAL(10,3)    DEFAULT NULL  COMMENT 'Numeric size (e.g. 500, 20)',
        size_unit     VARCHAR(20)      DEFAULT NULL  COMMENT 'Unit of size (ml, L, g, kg…)',
        pack_quantity INT              NOT NULL DEFAULT 1 COMMENT 'Units per pack',
        price         DECIMAL(10,2)   NOT NULL,
        mrp           DECIMAL(10,2)   DEFAULT NULL,
        stock         INT              NOT NULL DEFAULT 0,
        sku           VARCHAR(100)     DEFAULT NULL,
        sort_order    INT              NOT NULL DEFAULT 0,
        is_active     TINYINT(1)       NOT NULL DEFAULT 1,
        created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_pv_product   (product_id),
        INDEX idx_pv_sku       (sku),
        INDEX idx_pv_active    (is_active),
        CONSTRAINT fk_pv_product
          FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.info('[migrations] ✓ product_variants table ready');
  } catch (e) {
    console.warn('[migrations] CREATE TABLE product_variants:', e.message);
  }

  // ── 4. Create `bundle_items` table ────────────────────────────────────────
  // Defines which products (and optionally which variant) make up a bundle.
  // bundle_product_id → the parent bundle product
  // product_id        → a component product inside the bundle
  // variant_id        → optional: pin to a specific variant of the component
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS bundle_items (
        id                INT  NOT NULL AUTO_INCREMENT,
        bundle_product_id INT  NOT NULL COMMENT 'FK → products.id (the bundle)',
        product_id        INT  NOT NULL COMMENT 'FK → products.id (the component)',
        variant_id        INT  DEFAULT NULL COMMENT 'FK → product_variants.id (optional)',
        quantity          INT  NOT NULL DEFAULT 1,
        PRIMARY KEY (id),
        INDEX idx_bi_bundle  (bundle_product_id),
        INDEX idx_bi_product (product_id),
        INDEX idx_bi_variant (variant_id),
        CONSTRAINT fk_bi_bundle
          FOREIGN KEY (bundle_product_id) REFERENCES products         (id) ON DELETE CASCADE,
        CONSTRAINT fk_bi_product
          FOREIGN KEY (product_id)        REFERENCES products         (id) ON DELETE RESTRICT,
        CONSTRAINT fk_bi_variant
          FOREIGN KEY (variant_id)        REFERENCES product_variants (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.info('[migrations] ✓ bundle_items table ready');
  } catch (e) {
    console.warn('[migrations] CREATE TABLE bundle_items:', e.message);
  }

  // ── 5. Add `variant_id` to `order_items` ──────────────────────────────────
  // Links an order line-item to the specific variant that was purchased.
  // Nullable so existing rows (pre-variant) remain valid.
  try {
    const [rows] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'variant_id'`,
      [DB_NAME]
    );
    if (rows.length === 0) {
      await db.query(
        `ALTER TABLE \`order_items\`
         ADD COLUMN \`variant_id\` INT DEFAULT NULL,
         ADD CONSTRAINT fk_oi_variant
           FOREIGN KEY (variant_id) REFERENCES product_variants (id) ON DELETE SET NULL`
      );
      console.info('[migrations] ✓ Added column order_items.variant_id');
    }
  } catch (e) {
    console.warn('[migrations] ALTER order_items ADD variant_id:', e.message);
  }

  // ── 6. Re-enable FK checks ────────────────────────────────────────────────
  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (e) {
    console.warn('[migrations] SET FOREIGN_KEY_CHECKS=1 warning:', e.message);
  }

  console.info('[migrations] ✓ All migrations complete');
}

module.exports = { runMigrations };
