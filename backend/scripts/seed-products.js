/**
 * scripts/seed-products.js — Sample product seed data
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  DEVELOPMENT / TESTING ONLY — never run against a production database
 *     unless you intentionally want sample catalogue data present.
 *
 * PURPOSE:
 *   Populates the products table with realistic Indian grocery/FMCG products
 *   so the frontend catalogue is non-empty out of the box. Useful for local
 *   development and end-to-end testing without going through the admin panel.
 *
 * USAGE:
 *   node scripts/seed-products.js
 *   # or via npm script (add to package.json if desired):
 *   # "seed:products": "node scripts/seed-products.js"
 *
 * IDEMPOTENCY:
 *   Uses INSERT … ON DUPLICATE KEY UPDATE keyed on `name`. Running the script
 *   multiple times updates price/stock/description in place — no duplicate rows.
 *   A UNIQUE KEY on `name` is added automatically if it does not already exist.
 *
 * CONNECTION:
 *   Reads DATABASE_URL (or individual DB_* vars) from the environment via
 *   dotenv, exactly like the main application. Set these in your .env file.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('❌  seed-products.js must not be run in production. Exiting.');
  process.exit(1);
}

const db = require('../config/db');

/* ── Sample product catalogue ─────────────────────────────────────────────── */
// 15 realistic Indian grocery / FMCG products across five categories.
// Fields mirror the products table schema:
//   name, description, price, mrp, image, category, stock, unit, is_active
const PRODUCTS = [
  // ── Vegetables ──────────────────────────────────────────────────────────────
  {
    name:        'Fresh Tomatoes',
    description: 'Farm-fresh red tomatoes, ideal for curries, salads, and chutneys.',
    price:       25.00,
    mrp:         30.00,
    category:    'Vegetables',
    stock:       150,
    unit:        'kg',
  },
  {
    name:        'Onions',
    description: 'Premium quality onions sourced directly from Nashik farms.',
    price:       20.00,
    mrp:         25.00,
    category:    'Vegetables',
    stock:       200,
    unit:        'kg',
  },
  {
    name:        'Potatoes',
    description: 'Fresh potatoes, perfect for sabzi, fries, and snacks.',
    price:       18.00,
    mrp:         22.00,
    category:    'Vegetables',
    stock:       180,
    unit:        'kg',
  },
  {
    name:        'Green Capsicum',
    description: 'Crisp green bell peppers, great for stir-fries and salads.',
    price:       40.00,
    mrp:         50.00,
    category:    'Vegetables',
    stock:       100,
    unit:        'kg',
  },

  // ── Fruits ──────────────────────────────────────────────────────────────────
  {
    name:        'Alphonso Mangoes',
    description: 'Premium Ratnagiri Alphonso mangoes — the king of fruits.',
    price:       350.00,
    mrp:         400.00,
    category:    'Fruits',
    stock:       80,
    unit:        'dozen',
  },
  {
    name:        'Bananas',
    description: 'Fresh Robusta bananas, rich in potassium and natural energy.',
    price:       40.00,
    mrp:         50.00,
    category:    'Fruits',
    stock:       120,
    unit:        'dozen',
  },
  {
    name:        'Pomegranate',
    description: 'Juicy Solapur pomegranates, packed with antioxidants.',
    price:       80.00,
    mrp:         100.00,
    category:    'Fruits',
    stock:       90,
    unit:        'kg',
  },

  // ── Dairy ────────────────────────────────────────────────────────────────────
  {
    name:        'Full Cream Milk',
    description: 'Fresh full-cream cow milk, pasteurised and homogenised.',
    price:       28.00,
    mrp:         30.00,
    category:    'Dairy',
    stock:       200,
    unit:        'liter',
  },
  {
    name:        'Paneer',
    description: 'Soft and fresh cottage cheese made from pure cow milk.',
    price:       90.00,
    mrp:         100.00,
    category:    'Dairy',
    stock:       75,
    unit:        '200g',
  },
  {
    name:        'Dahi (Curd)',
    description: 'Thick and creamy set curd, made from full-cream milk.',
    price:       45.00,
    mrp:         50.00,
    category:    'Dairy',
    stock:       100,
    unit:        '500g',
  },

  // ── Grains & Pulses ──────────────────────────────────────────────────────────
  {
    name:        'Basmati Rice',
    description: 'Long-grain aged Basmati rice with a rich aroma, ideal for biryani.',
    price:       120.00,
    mrp:         140.00,
    category:    'Grains & Pulses',
    stock:       150,
    unit:        'kg',
  },
  {
    name:        'Toor Dal',
    description: 'Premium split pigeon peas, the base of everyday Indian dal.',
    price:       95.00,
    mrp:         110.00,
    category:    'Grains & Pulses',
    stock:       130,
    unit:        'kg',
  },
  {
    name:        'Whole Wheat Atta',
    description: 'Stone-ground whole wheat flour for soft rotis and parathas.',
    price:       55.00,
    mrp:         65.00,
    category:    'Grains & Pulses',
    stock:       160,
    unit:        'kg',
  },

  // ── Beverages ────────────────────────────────────────────────────────────────
  {
    name:        'Packaged Drinking Water',
    description: 'Purified mineral water, BIS-certified, 1-litre sealed bottle.',
    price:       20.00,
    mrp:         20.00,
    category:    'Beverages',
    stock:       500,
    unit:        'liter',
  },
  {
    name:        'Masala Chai Premix',
    description: 'Instant masala tea premix with ginger, cardamom, and tulsi.',
    price:       75.00,
    mrp:         85.00,
    category:    'Beverages',
    stock:       120,
    unit:        '200g',
  },
];

/* ── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Ensure a UNIQUE KEY on products.name exists so that
 * ON DUPLICATE KEY UPDATE works correctly.
 * Silently skips if the key already exists (ER_DUP_KEYNAME).
 */
async function ensureUniqueNameIndex() {
  try {
    await db.query(
      'ALTER TABLE `products` ADD UNIQUE KEY `uq_products_name` (`name`(150))'
    );
    console.log('  ✓  Added UNIQUE KEY uq_products_name on products.name');
  } catch (err) {
    // ER_DUP_KEYNAME  — index already exists, nothing to do
    // ER_TABLE_EXISTS — shouldn't happen here, but safe to ignore
    if (err.code !== 'ER_DUP_KEYNAME' && !err.message.includes('Duplicate key name')) {
      // Unexpected error — warn but don't abort; the INSERT will still work
      // if a unique constraint exists under a different name.
      console.warn('  ⚠  Could not add unique index on products.name:', err.message);
    }
  }
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
async function seedProducts() {
  console.log('\n  Seeding Aqualence products...\n');

  // Initialise the connection pool (required before any db.query() call)
  await db.connectDB();

  // Ensure the unique index exists so ON DUPLICATE KEY UPDATE is keyed on name
  await ensureUniqueNameIndex();

  let inserted = 0;
  let updated  = 0;

  for (const p of PRODUCTS) {
    const [result] = await db.query(
      `INSERT INTO products
         (name, description, price, mrp, image, category, stock, unit, is_active)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         description = VALUES(description),
         price       = VALUES(price),
         mrp         = VALUES(mrp),
         category    = VALUES(category),
         stock       = VALUES(stock),
         unit        = VALUES(unit),
         is_active   = 1`,
      [
        p.name,
        p.description,
        p.price,
        p.mrp ?? null,
        p.category,
        p.stock,
        p.unit,
      ]
    );

    // affectedRows = 1 → INSERT, 2 → UPDATE (ON DUPLICATE KEY), 0 → no change
    if (result.affectedRows === 1) {
      inserted++;
      console.log(`  +  [${p.category.padEnd(16)}]  ${p.name}`);
    } else if (result.affectedRows === 2) {
      updated++;
      console.log(`  ↺  [${p.category.padEnd(16)}]  ${p.name}  (updated)`);
    } else {
      console.log(`  –  [${p.category.padEnd(16)}]  ${p.name}  (no change)`);
    }
  }

  console.log('\n  ─────────────────────────────────────────────────────');
  console.log(`  Done!  ${inserted} inserted,  ${updated} updated,  ${PRODUCTS.length - inserted - updated} unchanged`);
  console.log(`  Total products in seed: ${PRODUCTS.length}`);
  console.log('  ─────────────────────────────────────────────────────\n');

  process.exit(0);
}

seedProducts().catch(err => {
  console.error('\n  ❌  Product seed failed:', err.code || err.message);
  if (err.code === 'ECONNREFUSED' || err.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('  ℹ   Check that DATABASE_URL (or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME) is set in your .env file.');
  }
  process.exit(1);
});
