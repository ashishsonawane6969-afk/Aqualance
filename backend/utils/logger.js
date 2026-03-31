'use strict';
/**
 * utils/logger.js — Persistent structured logging (A09:2025 fix)
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces console.log/error/warn throughout the app with a winston logger
 * that writes to rotating log files in production AND to the console in dev.
 *
 * Log files (production):
 *   /var/log/aqualence/app-YYYY-MM-DD.log   ← all logs (INFO+)
 *   /var/log/aqualence/error-YYYY-MM-DD.log ← errors only
 *   Rotates daily, keeps last 14 days, max 20 MB per file.
 *
 * Usage (drop-in replacement for console):
 *   const logger = require('./logger');
 *   logger.info('Server started');
 *   logger.warn('Rate limit hit', { ip: req.ip });
 *   logger.error('DB error', { error: err.message, context: '[authController]' });
 * ─────────────────────────────────────────────────────────────────────────────
 */

const winston = require('winston');
require('winston-daily-rotate-file');
const path = require('path');
const fs   = require('fs');

const isProduction = process.env.NODE_ENV === 'production';

// ── Log directory ────────────────────────────────────────────────────────────
// Production: /var/log/aqualence/  (create + chown before deploy)
// Development: ./logs/ (relative to backend/)
const LOG_DIR = isProduction
  ? '/var/log/aqualence'
  : path.join(__dirname, '../logs');

// Ensure log directory exists (development only — in production use provisioning)
if (!isProduction) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (_) {}
}

// ── Log format ───────────────────────────────────────────────────────────────
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss Z' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    return `${timestamp} ${level}: ${message}${metaStr}`;
  })
);

// ── Transports ───────────────────────────────────────────────────────────────
const transports = [];

// Always log to console (colorised in dev, plain in prod for journald/PM2)
transports.push(
  new winston.transports.Console({
    format: isProduction ? logFormat : consoleFormat,
    level:  isProduction ? 'warn' : 'debug',  // console shows warn+ in prod, debug+ in dev
  })
);

// In production, also write to rotating files
if (isProduction) {
  // All logs (info and above)
  transports.push(
    new winston.transports.DailyRotateFile({
      filename:     path.join(LOG_DIR, 'app-%DATE%.log'),
      datePattern:  'YYYY-MM-DD',
      level:        'info',
      format:       logFormat,
      maxFiles:     '14d',   // keep 14 days
      maxSize:      '20m',   // rotate at 20 MB
      zippedArchive: true,
    })
  );

  // Error-only log for quick incident response
  transports.push(
    new winston.transports.DailyRotateFile({
      filename:     path.join(LOG_DIR, 'error-%DATE%.log'),
      datePattern:  'YYYY-MM-DD',
      level:        'error',
      format:       logFormat,
      maxFiles:     '30d',   // keep errors for 30 days
      maxSize:      '20m',
      zippedArchive: true,
    })
  );
}

// ── Logger instance ──────────────────────────────────────────────────────────
const logger = winston.createLogger({
  level:       'info',
  transports,
  exitOnError: false,  // do not exit on handled exceptions
});

module.exports = logger;
