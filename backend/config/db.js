'use strict';

const mysql = require('mysql2/promise');

let pool;

/**
 * Create MySQL pool (Railway-safe)
 */
async function connectDB() {
  try {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT, 10) || 3306,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,

      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_POOL_SIZE, 10) || 10,
      queueLimit: 0,

      connectTimeout: 10000,

      ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    });

    // 🔥 TEST CONNECTION (IMPORTANT)
    const conn = await pool.getConnection();
    console.log(`✅ MySQL connected — ${process.env.DB_NAME}`);
    conn.release();

    return pool;

  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);

    // 🚫 DO NOT try to CREATE DATABASE on Railway
    // 🚫 DO NOT process.exit()

    throw err;
  }
}

/**
 * Get pool safely
 */
function getPool() {
  if (!pool) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return pool;
}

module.exports = {
  connectDB,
  getPool,
};
