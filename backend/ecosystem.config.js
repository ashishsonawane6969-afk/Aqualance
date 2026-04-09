/**
 * ecosystem.config.js — PM2 Process Manager Configuration
 * ─────────────────────────────────────────────────────────────────────────────
 * Fixes A10:2025 — Mishandling of Exceptional Conditions
 *
 * SETUP (run once on production server):
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save                    ← persist process list
 *   pm2 startup                 ← auto-start on server reboot (follow printed command)
 *
 * USEFUL COMMANDS:
 *   pm2 status                  ← see running processes
 *   pm2 logs aqualence          ← tail live logs
 *   pm2 logs aqualence --lines 200   ← last 200 lines
 *   pm2 restart aqualence       ← rolling restart (zero downtime)
 *   pm2 reload aqualence        ← graceful reload (SIGTERM → wait → restart)
 *   pm2 stop aqualence          ← stop without removing
 *   pm2 delete aqualence        ← remove from PM2 list
 *
 * UPDATING CODE:
 *   git pull
 *   pm2 reload aqualence        ← reload with new code (graceful, no downtime)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

module.exports = {
  apps: [
    {
      name: 'aqualence',
      script: 'server.js',
      cwd: __dirname,

      // ── Restart behaviour ────────────────────────────────────────────────
      // Restart on crash (exit code != 0). Exponential backoff prevents
      // restart loops from hammering a broken DB or missing env var.
      autorestart:          true,
      max_restarts:         10,
      min_uptime:           '10s',   // must stay up 10s to count as "started"
      restart_delay:        3000,    // wait 3s between restarts
      exp_backoff_restart_delay: 100,

      // ── Instance mode ────────────────────────────────────────────────────
      // Single instance — safe with in-memory rate-limit store.
      // To use cluster mode (multi-core), switch instances to 'max' AND
      // move rate-limit store to Redis (rate-limit-redis package).
      instances:  1,
      exec_mode: 'fork',

      // ── Logging ─────────────────────────────────────────────────────────
      // Logs are written to /var/log/aqualence/ (create dir + set perms first).
      // PM2 auto-rotates when files exceed max_size.
      error_file:     '/var/log/aqualence/error.log',
      out_file:       '/var/log/aqualence/out.log',
      log_date_format:'YYYY-MM-DD HH:mm:ss Z',
      merge_logs:      true,

      // ── Environment — DEVELOPMENT ────────────────────────────────────────
      env: {
        NODE_ENV: 'development',
        PORT:     5000,
      },

      // ── Environment — PRODUCTION ─────────────────────────────────────────
      // Start with: pm2 start ecosystem.config.js --env production
      env_production: {
        NODE_ENV:   'production',
        PORT:       5000,

        // ── REQUIRED: fill these in on the production server ──────────────
        // Do NOT store real secrets in this file — use .env or PM2 env vars:
        //   pm2 set aqualence:JWT_SECRET <your-secret>
        // Or keep a .env file (excluded from git) and dotenv loads it.

        // DB credentials for production (dedicated user, not root)
        // DB_HOST:     'localhost',
        // DB_USER:     'aqualence_app',
        // DB_PASSWORD: 'CHANGE_ME',
        // DB_NAME:     'aqualence_db',
        // DB_SSL:      'true',
      },

      // ── Watch (dev only — remove or set to false in production) ──────────
      watch:  false,
      ignore_watch: ['node_modules', '*.log'],

      // ── Memory limit ────────────────────────────────────────────────────
      // Restart if memory exceeds 500 MB (protects against memory leaks)
      max_memory_restart: '500M',
    },
  ],
};
