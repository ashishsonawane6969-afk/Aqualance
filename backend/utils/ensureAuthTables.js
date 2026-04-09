/**
 * utils/ensureAuthTables.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Auto-migration that runs on every server startup.
 *
 * WHY THIS EXISTS:
 *   The auth hardening added three columns to `users` and one new table
 *   (token_revocations). If the database was created from the OLD schema.sql
 *   (before those columns were added), every login returns HTTP 500 with:
 *     "Unknown column 'failed_attempts' in 'field list'"
 *   This migration detects and adds any missing pieces idempotently — no manual
 *   SQL scripts needed, no data loss on re-run.
 *
 * COLUMNS ENSURED:
 *   users.failed_attempts      — brute-force lockout counter
 *   users.locked_until         — lockout expiry timestamp
 *   users.must_change_password — forced password reset flag
 *   users.taluka_id            — salesman area assignment
 *   users.taluka_name          — salesman area name (denormalised for speed)
 *
 * TABLE ENSURED:
 *   token_revocations          — per-token JTI revocation for logout
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const db = require('../config/db');

let _done = false;

async function ensureAuthTables() {
  if (_done) return;

  // ── 0. Create core tables if this is a brand-new database ──────────────────
  // When db.js auto-created the database, it's empty — no tables at all.
  // Create users, products, orders, order_items first so ALTERs below succeed.
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id                   INT              NOT NULL AUTO_INCREMENT,
        name                 VARCHAR(100)     NOT NULL,
        phone                VARCHAR(20)      NOT NULL,
        password             VARCHAR(255)     NOT NULL,
        role                 ENUM('admin','delivery','salesman') NOT NULL DEFAULT 'delivery',
        is_active            TINYINT(1)       NOT NULL DEFAULT 1,
        failed_attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
        locked_until         TIMESTAMP        NULL DEFAULT NULL,
        must_change_password TINYINT(1)       NOT NULL DEFAULT 0,
        taluka_id            INT              DEFAULT NULL,
        taluka_name          VARCHAR(100)     DEFAULT NULL,
        created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_users_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) { console.warn('[ensureAuthTables] users:', e.message); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id          INT             NOT NULL AUTO_INCREMENT,
        name        VARCHAR(150)    NOT NULL,
        description TEXT,
        price       DECIMAL(10,2)   NOT NULL,
        mrp         DECIMAL(10,2)   DEFAULT NULL,
        image       LONGTEXT        NOT NULL,             -- LONGTEXT: supports base64 data URIs up to 4 GB
        images      TEXT            DEFAULT NULL,
        category    VARCHAR(100)    NOT NULL DEFAULT 'General',
        stock       INT             NOT NULL DEFAULT 100,
        unit        VARCHAR(50)     NOT NULL DEFAULT 'piece',
        is_active   TINYINT(1)      NOT NULL DEFAULT 1,
        created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) { console.warn('[ensureAuthTables] products:', e.message); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id            INT             NOT NULL AUTO_INCREMENT,
        order_number  VARCHAR(20)     NOT NULL,
        customer_name VARCHAR(100)    NOT NULL,
        shop_name     VARCHAR(150)    NOT NULL,
        phone         VARCHAR(20)     NOT NULL,
        address       TEXT            NOT NULL,
        city          VARCHAR(100)    NOT NULL,
        pincode       VARCHAR(10)     NOT NULL,
        latitude      DECIMAL(10,7)   DEFAULT NULL,
        longitude     DECIMAL(10,7)   DEFAULT NULL,
        total_price   DECIMAL(10,2)   NOT NULL,
        notes         TEXT,
        status        ENUM('pending','assigned','out_for_delivery','delivered','cancelled') NOT NULL DEFAULT 'pending',
        delivery_id   INT             DEFAULT NULL,
        created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_orders_number (order_number),
        CONSTRAINT fk_orders_delivery FOREIGN KEY (delivery_id) REFERENCES users (id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) { console.warn('[ensureAuthTables] orders:', e.message); }

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id           INT             NOT NULL AUTO_INCREMENT,
        order_id     INT             NOT NULL,
        product_id   INT             NOT NULL,
        product_name VARCHAR(150)    NOT NULL,
        quantity     INT             NOT NULL,
        price        DECIMAL(10,2)   NOT NULL,
        PRIMARY KEY (id),
        CONSTRAINT fk_items_order   FOREIGN KEY (order_id)   REFERENCES orders   (id) ON DELETE CASCADE,
        CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products (id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) { console.warn('[ensureAuthTables] order_items:', e.message); }

  // ── 1. Add missing columns to `users` ──────────────────────────────────────
  // Uses INFORMATION_SCHEMA to check existence first — compatible with
  // MySQL 5.7 and 8.0+. ALTER TABLE ADD COLUMN IF NOT EXISTS requires 8.0+
  // and throws a syntax error on 5.7, which is what caused these warnings.
  const DB_NAME = process.env.DB_NAME || 'aqualence_db';

  const userColumns = [
    ['failed_attempts',      'TINYINT UNSIGNED NOT NULL DEFAULT 0'],
    ['locked_until',         'TIMESTAMP NULL DEFAULT NULL'],
    ['must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['taluka_id',            'INT DEFAULT NULL'],
    ['taluka_name',          'VARCHAR(100) DEFAULT NULL'],
    // MFA columns (admin TOTP — P2 fix)
    ['mfa_secret',           'VARCHAR(255) DEFAULT NULL'],
    ['mfa_enabled',          'TINYINT(1)   NOT NULL DEFAULT 0'],
  ];

  for (const [col, def] of userColumns) {
    try {
      // Check INFORMATION_SCHEMA — works on MySQL 5.7 and 8.0+
      const [rows] = await db.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = ?`,
        [DB_NAME, col]
      );
      if (rows.length === 0) {
        // Column missing — add it (no IF NOT EXISTS needed, we already checked)
        await db.query('ALTER TABLE users ADD COLUMN `' + col + '` ' + def);
        console.info(`[ensureAuthTables] Added column users.${col}`);
      }
    } catch (e) {
      console.warn(`[ensureAuthTables] ALTER users ADD ${col}:`, e.message);
    }
  }

  // ── 1b. Widen mfa_secret if it was created as VARCHAR(64) ───────────────────
  // Early installs created mfa_secret as VARCHAR(64) which is too small for the
  // AES-256-GCM encrypted TOTP secret (iv + authTag + ciphertext = ~120 chars).
  // This migration widens it safely — MODIFY COLUMN never truncates existing data.
  try {
    const [mfaCol] = await db.query(
      `SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'mfa_secret'`,
      [DB_NAME]
    );
    if (mfaCol.length > 0 && mfaCol[0].CHARACTER_MAXIMUM_LENGTH < 255) {
      await db.query("ALTER TABLE `users` MODIFY COLUMN `mfa_secret` VARCHAR(255) DEFAULT NULL");
      console.info('[ensureAuthTables] ✓ Widened users.mfa_secret to VARCHAR(255)');
    }
  } catch (e) {
    console.warn('[ensureAuthTables] mfa_secret widen:', e.message);
  }

  // ── 1c. otp_pending table (SMS OTP login) ───────────────────────────────────
  try {
    await db.query(
      'CREATE TABLE IF NOT EXISTS otp_pending (' +
      '  id         INT          NOT NULL AUTO_INCREMENT,' +
      '  user_id    INT          NOT NULL,' +
      '  otp_hash   VARCHAR(255) NOT NULL,' +
      '  attempts   TINYINT      NOT NULL DEFAULT 0,' +
      '  expires_at TIMESTAMP    NOT NULL,' +
      '  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,' +
      '  PRIMARY KEY (id),' +
      '  UNIQUE KEY uq_otp_user (user_id),' +
      '  INDEX idx_otp_expires (expires_at),' +
      '  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE' +
      ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
    );
  } catch (e) { console.warn('[ensureAuthTables] otp_pending:', e.message); }

  // ── 2. Ensure token_revocations table exists ────────────────────────────────
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS token_revocations (
        jti        VARCHAR(36)  NOT NULL,
        user_id    INT          NOT NULL,
        revoked_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP    NOT NULL,
        PRIMARY KEY (jti),
        INDEX idx_expires (expires_at),
        INDEX idx_user    (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) {
    console.warn('[ensureAuthTables] token_revocations:', e.message);
  }

  // ── 3. Ensure shop_leads exists (salesman module) ───────────────────────────
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS shop_leads (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        salesman_id  INT          NOT NULL,
        shop_name    VARCHAR(150) NOT NULL,
        shop_type    VARCHAR(100) DEFAULT '',
        owner_name   VARCHAR(100) NOT NULL,
        mobile       VARCHAR(20)  NOT NULL,
        village      VARCHAR(100) NOT NULL,
        taluka       VARCHAR(100) NOT NULL,
        district     VARCHAR(100) NOT NULL,
        sale_status  ENUM('YES','NO') NOT NULL DEFAULT 'NO',
        grand_total  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
        photo_proof  MEDIUMTEXT   DEFAULT NULL,
        notes        TEXT         DEFAULT NULL,
        latitude     DECIMAL(10,7) DEFAULT NULL,
        longitude    DECIMAL(10,7) DEFAULT NULL,
        gps_accuracy DECIMAL(8,2)  DEFAULT NULL,
        address_geo  TEXT          DEFAULT NULL,
        geo_verified TINYINT(1)    DEFAULT 0,
        distance_km  DECIMAL(8,3)  DEFAULT NULL,
        visited_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (salesman_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) {
    console.warn('[ensureAuthTables] shop_leads:', e.message);
  }

  // ── 3a. Ensure shop_leads columns exist (Existing DB audit) ───────────────
  const leadCols = [
    ['grand_total',    'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
    ['latitude',       'DECIMAL(10,7) DEFAULT NULL'],
    ['longitude',      'DECIMAL(10,7) DEFAULT NULL'],
    ['gps_accuracy',   'DECIMAL(8,2)  DEFAULT NULL'],
    ['address_geo',    'TEXT          DEFAULT NULL'],
    ['geo_verified',   'TINYINT(1)    DEFAULT 0'],
    ['distance_km',    'DECIMAL(8,3)  DEFAULT NULL'],
    ['shop_type',      'VARCHAR(100)  DEFAULT \'\''],
    ['geo_suspicious', 'TINYINT(1)    DEFAULT 0 COMMENT \'1 = coordinates match taluka center exactly or India bbox failed\''],
  ];
  for (const [col, def] of leadCols) {
    try {
      const [rows] = await db.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'shop_leads' AND COLUMN_NAME = ?`,
        [DB_NAME, col]
      );
      if (rows.length === 0) {
        await db.query('ALTER TABLE `shop_leads` ADD COLUMN `' + col + '` ' + def);
        console.info(`[ensureAuthTables] ✓ Added column shop_leads.${col}`);
      }
    } catch (e) {
      console.warn(`[ensureAuthTables] ALTER shop_leads ADD ${col}:`, e.message);
    }
  }

  // ── 3b. Ensure lead_products exists ────────────────────────────────────────
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
    // Add indexes if they don't exist
    for (const [idx, col] of [['idx_lp_lead', 'lead_id'], ['idx_lp_product', 'product_id']]) {
      try {
        await db.query('CREATE INDEX ' + idx + ' ON lead_products(' + col + ')');
      } catch (_) {}
    }
  } catch (e) {
    console.warn('[ensureAuthTables] lead_products:', e.message);
  }

  // ── 4. Ensure salesman_areas exists ────────────────────────────────────────
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS salesman_areas (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        salesman_id INT          NOT NULL,
        taluka      VARCHAR(100) NOT NULL,
        district    VARCHAR(100) NOT NULL,
        assigned_by INT          DEFAULT NULL,
        assigned_at TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_salesman_taluka (salesman_id, taluka),
        FOREIGN KEY (salesman_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  } catch (e) {
    console.warn('[ensureAuthTables] salesman_areas:', e.message);
  }

  // ── 5. Ensure all products columns exist (existing DB migration) ─────────────
  // CREATE TABLE IF NOT EXISTS above only fires on fresh installs.
  // Existing databases may be missing mrp, images, unit, or updated_at if they
  // were created from an older schema — the UPDATE query in productController
  // references all of these and throws "Unknown column" → HTTP 500 if any are absent.
  const productColumns = [
    ['mrp',        'DECIMAL(10,2) DEFAULT NULL',                          null],
    ['images',     "TEXT DEFAULT NULL",                                    null],
    ['unit',       "VARCHAR(50) NOT NULL DEFAULT 'piece'",                 null],
    ['updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP', null],
    // ── Bundle product columns ──
    ['base_quantity', 'DECIMAL(10,2) DEFAULT NULL'],
    ['base_unit',     "VARCHAR(10)  DEFAULT NULL"],
    ['pack_size',     'INT          DEFAULT NULL'],
    ['is_bundle',     'TINYINT(1)   NOT NULL DEFAULT 0'],
    ['display_name',  'VARCHAR(255) DEFAULT NULL'],
  ];
  for (const [col, def] of productColumns) {
    try {
      const [rows] = await db.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = ?`,
        [DB_NAME, col]
      );
      if (rows.length === 0) {
        await db.query('ALTER TABLE `products` ADD COLUMN `' + col + '` ' + def);
        console.info(`[ensureAuthTables] ✓ Added column products.${col}`);
      }
    } catch (e) {
      console.warn(`[ensureAuthTables] ALTER products ADD ${col}:`, e.message);
    }
  }

  // ── 6. Upgrade products.image → LONGTEXT ─────────────────────────────────────
  // Any column type smaller than LONGTEXT will fail on base64 image uploads:
  //   VARCHAR(any) — obvious; even VARCHAR(65535) fails on images > ~48KB
  //   TEXT         — 65535 bytes max → fails on any real photo
  //   MEDIUMTEXT   — 16MB max → fine for most, but we use LONGTEXT for safety
  // We widen from ANY type that is not already LONGTEXT. MODIFY COLUMN is safe
  // on existing data — it only changes the type ceiling, never truncates.
  try {
    const [imgColRows] = await db.query(
      `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'image'`,
      [DB_NAME]
    );
    if (imgColRows.length > 0 && imgColRows[0].DATA_TYPE !== 'longtext') {
      const fromType = imgColRows[0].DATA_TYPE;
      await db.query(
        'ALTER TABLE `products` MODIFY COLUMN `image` LONGTEXT NOT NULL'
      );
      console.info(`[ensureAuthTables] ✓ Upgraded products.image ${fromType} → LONGTEXT (base64 image support)`);
    }
  } catch (e) {
    console.error('[ensureAuthTables] ❌ Could not upgrade products.image to LONGTEXT:', e.message);
    console.error('[ensureAuthTables]    Run manually: ALTER TABLE products MODIFY COLUMN image LONGTEXT NOT NULL;');
  }

  // ── 7. Seed default admin if users table is completely empty ──────────────
  // This catches a fresh DB install where schema.sql was applied but seed.js
  // was never run. Without at least one user, login is impossible.
  try {
    const [rows] = await db.query('SELECT COUNT(*) AS cnt FROM users');
    if (rows[0].cnt === 0) {
      const bcrypt = require('./bcrypt');
      const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
      // SECURITY: All seed users have must_change_password=1 so they are forced
      // to set a new password on first login. Default passwords are intentionally
      // weak/memorable — they MUST be changed before the app is used in production.
      const seeds = [
        { name: 'Admin',        phone: '9000000001', password: 'Admin@123',    role: 'admin' },
        { name: 'Ravi Kumar',   phone: '9000000002', password: 'Delivery@123', role: 'delivery' },
        { name: 'Suresh Patil', phone: '9000000003', password: 'Delivery@123', role: 'delivery' },
        { name: 'Ajay Salesman',phone: '9000000004', password: 'Sales@123',    role: 'salesman' },
      ];
      for (const u of seeds) {
        const hash = await bcrypt.hash(u.password, rounds);
        await db.query(
          // must_change_password=1 forces a password change on first login (A06 fix)
          `INSERT IGNORE INTO users (name, phone, password, role, must_change_password) VALUES (?, ?, ?, ?, 1)`,
          [u.name, u.phone, hash, u.role]
        );
      }
      console.info('[ensureAuthTables] ✓ Default seed users inserted (must_change_password=1)');
      console.warn('[ensureAuthTables] ⚠  CHANGE DEFAULT PASSWORDS BEFORE GOING LIVE:');
      console.warn('[ensureAuthTables]    Admin: 9000000001 / Admin@123  → change immediately');
    }
  } catch (e) {
    console.warn('[ensureAuthTables] Seed check warning:', e.message);
  }

  // ── 8. Geo Tables (via controller migration) ──────────────────────────────
  try {
    const { ensureGeoTables } = require('../controllers/geoController');
    await ensureGeoTables();
  } catch (e) {
    console.warn('[ensureAuthTables] geo tables migration warning:', e.message);
  }

  // Reset the product column cache in productController so that the next
  // request re-queries INFORMATION_SCHEMA and picks up any columns added above.
  // Without this, UPDATE queries built from the stale cache omit mrp/unit/images.
  try {
    const { resetProductColsCache } = require('../controllers/productController');
    resetProductColsCache();
  } catch (_) { /* controller not loaded yet on very first boot — safe to ignore */ }

  _done = true;
  console.info('[ensureAuthTables] ✓ Database schema up to date');
}

module.exports = { ensureAuthTables };