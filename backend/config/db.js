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

      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false
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
  // getConnection() — returns a pooled connection with transaction support.
  // Used by controllers that need BEGIN/COMMIT/ROLLBACK (e.g. orderController).
  // Caller MUST call conn.release() in a finally block to return it to the pool.
  getConnection: async () => {
    if (!pool) throw new Error('Database not initialized. Call connectDB() first.');
    return pool.getConnection();
  },
  query: async (...args) => {
    if (!pool) throw new Error('DB not initialized');
    return pool.query(...args);
  }
};
