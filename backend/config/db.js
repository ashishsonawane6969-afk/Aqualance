'use strict';

const mysql = require('mysql2/promise');

let pool;

/**
 * Create MySQL pool (Railway-safe)
 */
async function connectDB() {
  try {
    pool = mysql.createPool({
      uri: process.env.DATABASE_URL,   // ✅ Railway connection

      waitForConnections: true,
      connectionLimit: parseInt(process.env.DB_POOL_SIZE, 10) || 10,
      queueLimit: 0,

      connectTimeout: 10000,

      ssl: false   // ✅ IMPORTANT: Railway MySQL doesn't need SSL
    });

    // 🔥 TEST CONNECTION
    const conn = await pool.getConnection();
    console.log("✅ MySQL connected successfully");
    conn.release();

    return pool;

  } catch (err) {
    console.error("❌ MySQL connection failed:", err.message);
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
  query: async (...args) => {
    if (!pool) throw new Error("DB not initialized");
    return pool.query(...args);
  }
};
