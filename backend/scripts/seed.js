/**
 * scripts/seed.js — Development seed data
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  DEVELOPMENT ONLY — never run against a production database.
 *
 * CREDENTIALS — read from environment variables (no hardcoded passwords):
 *   SEED_ADMIN_NAME     SEED_ADMIN_PHONE     SEED_ADMIN_PASSWORD
 *   SEED_DELIVERY_NAME  SEED_DELIVERY_PHONE  SEED_DELIVERY_PASSWORD
 *   SEED_SALESMAN_NAME  SEED_SALESMAN_PHONE  SEED_SALESMAN_PASSWORD
 *
 * If env vars are not set, cryptographically random passwords are generated
 * and printed ONCE to the console — copy them before the script exits.
 * All seeded users have must_change_password=1 (forced reset on first login).
 */
'use strict';

require('dotenv').config();

if (process.env.NODE_ENV === 'production') {
  console.error('❌  Seed script must not be run in production. Exiting.');
  process.exit(1);
}

const crypto = require('crypto');
const bcrypt = require('../utils/bcrypt.js');
const db     = require('../config/db');
const mysql  = require('mysql2/promise');
const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

const WORDS = ['alpha','bravo','cedar','delta','ember','frost','grove','haven',
  'indie','jolly','karma','lunar','maple','noble','ocean','prime',
  'river','solar','tower','ultra','valor','winds','xenon','yield'];

function randomPassword() {
  const w = () => WORDS[crypto.randomInt(WORDS.length)];
  const n = String(crypto.randomInt(1000, 9999));
  const s = ['!','@','#','$','%','&'][crypto.randomInt(6)];
  return `${w()}-${w()}-${n}${s}`;
}

function resolveUser(nameKey, phoneKey, passKey, defName, defPhone, role) {
  const password    = process.env[passKey] || randomPassword();
  const isGenerated = !process.env[passKey];
  return { name: process.env[nameKey] || defName, phone: process.env[phoneKey] || defPhone,
           password, role, isGenerated };
}

async function ensureDatabase() {
  const DB_NAME = process.env.DB_NAME || 'aqualence_db';
  try {
    await db.query('SELECT 1');
  } catch (err) {
    if (err.code === 'ER_BAD_DB_ERROR') {
      console.log(`  Creating database '${DB_NAME}'...`);
      const boot = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        connectTimeout: 10_000,
      });
      await boot.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      await boot.end();
      console.log(`  OK  Database '${DB_NAME}' created`);
      const { ensureAuthTables } = require('../utils/ensureAuthTables');
      await ensureAuthTables();
    } else { throw err; }
  }
}

async function seed() {
  console.log('\n  Seeding Aqualence database...\n');

  const users = [
    resolveUser('SEED_ADMIN_NAME',    'SEED_ADMIN_PHONE',    'SEED_ADMIN_PASSWORD',
                'Admin',         '9000000001', 'admin'),
    resolveUser('SEED_DELIVERY_NAME', 'SEED_DELIVERY_PHONE', 'SEED_DELIVERY_PASSWORD',
                'Ravi Kumar',    '9000000002', 'delivery'),
    resolveUser('SEED_SALESMAN_NAME', 'SEED_SALESMAN_PHONE', 'SEED_SALESMAN_PASSWORD',
                'Ajay Salesman', '9000000004', 'salesman'),
  ];

  const generated = [];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, ROUNDS);
    await db.query(
      `INSERT INTO users (name, phone, password, role, must_change_password)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         password=VALUES(password), name=VALUES(name),
         role=VALUES(role), must_change_password=1`,
      [u.name, u.phone, hash, u.role]
    );
    console.log(`  OK  ${u.role.padEnd(10)} ${u.name.padEnd(16)} phone: ${u.phone}`);
    if (u.isGenerated) generated.push(u);
  }

  console.log('\n  Seed complete!\n');

  if (generated.length) {
    console.log('  AUTO-GENERATED PASSWORDS (copy now):');
    console.log('  --------------------------------------------------------');
    for (const g of generated) {
      console.log(`  ${g.role.padEnd(10)} ${g.phone}  password: ${g.password}`);
    }
    console.log('  --------------------------------------------------------');
    console.log('  All accounts require password change on first login.\n');
  }

  console.log('  Admin:    http://localhost:5000/admin/login.html');
  console.log('  Delivery: http://localhost:5000/delivery/login.html');
  console.log('  Salesman: http://localhost:5000/salesman/login.html\n');
  process.exit(0);
}

ensureDatabase()
  .then(() => seed())
  .catch(err => { console.error('Seed failed:', err.code || err.message); process.exit(1); });
