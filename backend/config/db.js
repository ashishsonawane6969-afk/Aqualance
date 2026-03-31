/**
 * config/db.js — MySQL connection pool
 * ─────────────────────────────────────────────────────────────────────────────
 * Security notes:
 *
 *  SSL/TLS: Set DB_SSL=true in .env when connecting to a remote/cloud MySQL
 *  instance (e.g. PlanetScale, AWS RDS, DigitalOcean Managed DB). This encrypts
 *  credentials and data in transit. For local dev, leave DB_SSL unset.
 *
 *  Least privilege: The DB user should have only SELECT/INSERT/UPDATE/DELETE
 *  on aqualence_db — NOT CREATE, DROP, GRANT, or FILE. Never connect as root
 *  in production.
 *
 *  Timeouts: acquireTimeout prevents hanging requests piling up if the DB is
 *  slow; connectTimeout prevents indefinite connection attempts on startup.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const mysql = require('mysql2/promise');

const DB_NAME  = process.env.DB_NAME || 'aqualence_db';
const DB_HOST  = process.env.DB_HOST || 'localhost';
const DB_PORT  = parseInt(process.env.DB_PORT, 10) || 3306;
const DB_USER  = process.env.DB_USER || 'root';
const DB_PASS  = process.env.DB_PASSWORD || '';

const sslConfig = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: true }
  : false;

// Pool used by all controllers — always targets aqualence_db
const pool = mysql.createPool({
  host:               DB_HOST,
  port:               DB_PORT,
  user:               DB_USER,
  password:           DB_PASS,
  database:           DB_NAME,
  ssl:                sslConfig,
  waitForConnections: true,
  connectionLimit:    parseInt(process.env.DB_POOL_SIZE, 10) || 10,
  queueLimit:         0,
  connectTimeout:     10_000,
  timezone:           '+00:00',
});

// Verify connectivity on startup.
// If the database does not exist yet (ER_BAD_DB_ERROR), create it automatically
// then let ensureAuthTables() (called in server.js) build all tables and seed users.
(async () => {
  try {
    const conn = await pool.getConnection();
    console.log(`✅  MySQL connected — ${DB_NAME}${sslConfig ? ' (SSL)' : ''}`);
    conn.release();
  } catch (err) {
    if (err.code === 'ER_BAD_DB_ERROR') {
      // Database does not exist — create it, then reconnect
      console.warn(`⚠️   Database '${DB_NAME}' not found — creating it now…`);
      try {
        // Connect WITHOUT specifying a database to run CREATE DATABASE
        const bootstrap = await mysql.createConnection({
          host: DB_HOST, port: DB_PORT,
          user: DB_USER, password: DB_PASS,
          ssl: sslConfig, connectTimeout: 10_000,
        });
        await bootstrap.query(
          `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        await bootstrap.end();
        console.log(`✅  Database '${DB_NAME}' created — tables will be built on first request`);
        // The pool will now connect successfully on its next attempt
      } catch (createErr) {
        console.error('❌  Could not create database:', createErr.code || createErr.message);
        console.error('   Check DB_USER has CREATE privilege, or create the database manually:');
        console.error(`   mysql -u ${DB_USER} -p -e "CREATE DATABASE ${DB_NAME}"`);
        process.exit(1);
      }
    } else {
      console.error('❌  MySQL connection failed:', err.code || err.message);
      console.error('   Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD in your .env');
      process.exit(1);
    }
  }
})();

module.exports = pool;
