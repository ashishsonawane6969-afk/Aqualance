/**
 * utils/errors.js
 * ─────────────────────────────────────────────────────────────────────────────
 * OWASP A09 – Security Logging & Monitoring Failures
 *
 * Centralised error handler for controllers.
 * Problem being fixed: every controller was doing:
 *   res.status(500).json({ success: false, message: err.message });
 *
 * This leaks internal error messages (DB query text, table names, column names,
 * file paths) directly to the client — a significant information disclosure
 * vulnerability. MySQL errors in particular are verbose about schema structure.
 *
 * Fix: log the full error server-side; return only a generic message externally.
 *
 * Usage:
 *   const { serverError } = require('../utils/errors');
 *   catch (err) { serverError(res, err, '[orderController.create]'); }
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const logger = require('./logger');

/**
 * Log the real error internally; send a safe generic response to the client.
 * @param {import('express').Response} res
 * @param {Error} err
 * @param {string} context  - e.g. '[orderController.create]' for log filtering
 */
function serverError(res, err, context = '[server]') {
  // Full error — internal only, never sent to client
  logger.error(context, { error: err.message, stack: err.stack?.split('\n')[1]?.trim() });

  // Generic message — safe to send externally
  res.status(500).json({ success: false, message: 'An unexpected error occurred. Please try again.' });
}


/**
 * parseId — safely parse a URL :param as a positive integer.
 *
 * Issue 5 fix: req.params values are always strings in Express. Passing them
 * directly to parameterised queries (even safely) means '1abc' silently becomes
 * 1 in MySQL's implicit cast, and non-numeric strings like 'admin' become 0,
 * potentially matching rows with id=0 or bypassing integer-based auth checks.
 *
 * Returns null if the value is not a valid positive integer — callers should
 * reject the request with a 400 before querying the DB.
 *
 * @param {string|number} val
 * @returns {number|null}
 */
function parseId(val) {
  const n = parseInt(val, 10);
  // Reject NaN, 0, negative, and strings with trailing non-digits ('1abc')
  if (!Number.isInteger(n) || n <= 0 || String(n) !== String(val)) return null;
  return n;
}

module.exports = { serverError, parseId };
