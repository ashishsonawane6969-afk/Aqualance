'use strict';
/**
 * controllers/otpController.js — SMS OTP verification (admin login step 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow:
 *   POST /api/auth/login      → password OK → OTP sent → { otp_required, otp_token }
 *   POST /api/auth/verify-otp → OTP checked → JWT cookie set → { success, user }
 *   POST /api/auth/resend-otp → new OTP sent (30 s cooldown)
 *
 * Security:
 *   • OTP stored as bcrypt hash — never plain text
 *   • 5-minute expiry
 *   • Max 3 attempts — record deleted on exhaustion
 *   • Rate limited by authLimiter (10/15 min per IP)
 *   • otp_token is a short-lived JWT (5 min) linking OTP step to user
 */

const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const db      = require('../config/db');
const bcrypt  = require('../utils/bcrypt');
const { serverError } = require('../utils/errors');
const secAlerts        = require('../utils/securityAlerts');

const COOKIE_NAME  = 'aq_auth';
const MAX_ATTEMPTS = 3;
const OTP_TEMP_SECRET = (process.env.JWT_SECRET || '') + '_mfa_pending'; // same as mfaController

function verifyOtpTempToken(token) {
  try {
    const d = jwt.verify(token, OTP_TEMP_SECRET, { algorithms: ['HS256'] });
    return d.type === 'mfa_pending' ? d : null;
  } catch { return null; }
}

function parseExpiry(str) {
  const u = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const m = String(str).match(/^(\d+)([smhd])$/);
  return m ? parseInt(m[1], 10) * (u[m[2]] || 86400000) : 7 * 86400000;
}

/* ═══════════════════════════════════════════════════════════════
   POST /api/auth/verify-otp
   Body: { otp_token, otp }
═══════════════════════════════════════════════════════════════ */
exports.verifyOtp = async (req, res) => {
  try {
    const { otp_token, otp } = req.body;

    if (!otp_token || !otp) {
      return res.status(400).json({ success: false, message: 'otp_token and otp are required' });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'OTP must be exactly 6 digits' });
    }

    const decoded = verifyOtpTempToken(otp_token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'OTP session expired. Please log in again.',
      });
    }

    const userId = decoded.sub;

    const [rows] = await db.query(
      `SELECT u.id, u.name, u.phone, u.role, u.is_active, u.must_change_password,
              u.failed_attempts,
              o.otp_hash, o.attempts, o.expires_at
       FROM users u
       JOIN otp_pending o ON o.user_id = u.id
       WHERE u.id = ? LIMIT 1`,
      [userId]
    );

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: 'OTP not found or already used. Please log in again.',
      });
    }

    const row = rows[0];

    // Check expiry
    if (new Date(row.expires_at) < new Date()) {
      await db.query('DELETE FROM otp_pending WHERE user_id = ?', [userId]);
      return res.status(401).json({ success: false, message: 'OTP has expired. Please log in again.' });
    }

    // Check max attempts
    if (row.attempts >= MAX_ATTEMPTS) {
      await db.query('DELETE FROM otp_pending WHERE user_id = ?', [userId]);
      secAlerts.accountLocked(userId, req.ip, MAX_ATTEMPTS);
      return res.status(401).json({
        success: false,
        message: 'Too many incorrect attempts. Please log in again.',
      });
    }

    // Verify hash
    const match = await bcrypt.compare(otp, row.otp_hash);

    if (!match) {
      const newAttempts = row.attempts + 1;
      await db.query('UPDATE otp_pending SET attempts = ? WHERE user_id = ?', [newAttempts, userId]);
      const remaining = MAX_ATTEMPTS - newAttempts;
      console.warn(`[otp] Wrong OTP — user: ${userId} — IP: ${req.ip}`);

      if (newAttempts >= MAX_ATTEMPTS) {
        await db.query('DELETE FROM otp_pending WHERE user_id = ?', [userId]);
        return res.status(401).json({ success: false, message: 'Too many incorrect attempts. Please log in again.' });
      }
      return res.status(401).json({
        success: false,
        message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
      });
    }

    // OTP correct — delete it (single use)
    await db.query('DELETE FROM otp_pending WHERE user_id = ?', [userId]);

    // Reset failed_attempts
    if (row.failed_attempts > 0) {
      await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [userId]);
    }

    // Issue full JWT cookie
    const jtiVal    = crypto.randomUUID();
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    const token = jwt.sign(
      { jti: jtiVal, id: row.id, name: row.name, role: row.role,
        ...(row.must_change_password ? { forceReset: true } : {}) },
      process.env.JWT_SECRET,
      { expiresIn, algorithm: 'HS256' }
    );

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge:   parseExpiry(expiresIn),
      path:     '/',
    });

    console.info(`[otp] Login complete — user: ${row.id} role: ${row.role} — IP: ${req.ip}`);

    res.json({
      success: true,
      user: {
        id:                   row.id,
        name:                 row.name,
        phone:                row.phone,
        role:                 row.role,
        must_change_password: !!row.must_change_password,
      },
    });

  } catch (err) {
    serverError(res, err, '[otpController.verifyOtp]');
  }
};

/* ═══════════════════════════════════════════════════════════════
   POST /api/auth/resend-otp
   Body: { otp_token }
   30-second cooldown enforced.
═══════════════════════════════════════════════════════════════ */
exports.resendOtp = async (req, res) => {
  try {
    const { otp_token } = req.body;
    if (!otp_token) {
      return res.status(400).json({ success: false, message: 'otp_token is required' });
    }

    const decoded = verifyOtpTempToken(otp_token);
    if (!decoded) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }

    const userId = decoded.sub;

    // Cooldown check
    const [existing] = await db.query(
      'SELECT created_at FROM otp_pending WHERE user_id = ?', [userId]
    );
    if (existing.length) {
      const elapsed = Date.now() - new Date(existing[0].created_at).getTime();
      if (elapsed < 30000) {
        const wait = Math.ceil((30000 - elapsed) / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${wait} seconds before requesting a new OTP.`,
        });
      }
    }

    const [users] = await db.query('SELECT phone FROM users WHERE id = ?', [userId]);
    if (!users.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const { generateOtp, sendOtp } = require('../services/sms');
    const otp    = generateOtp();
    const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const hash   = await bcrypt.hash(otp, rounds);
    const expiry = new Date(Date.now() + 5 * 60 * 1000);

    await db.query(
      `INSERT INTO otp_pending (user_id, otp_hash, attempts, expires_at)
       VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE
         otp_hash   = VALUES(otp_hash),
         attempts   = 0,
         expires_at = VALUES(expires_at),
         created_at = NOW()`,
      [userId, hash, expiry]
    );

    const sent = await sendOtp(users[0].phone, otp);
    if (!sent.success) {
      return res.status(503).json({ success: false, message: 'Could not send OTP. Please try again.' });
    }

    res.json({ success: true, message: 'New OTP sent to your registered phone number.' });
  } catch (err) {
    serverError(res, err, '[otpController.resendOtp]');
  }
};
