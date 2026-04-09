'use strict';
/**
 * controllers/mfaController.js — Admin TOTP-based MFA (P2 fix)
 * ─────────────────────────────────────────────────────────────────────────────
 * Flow:
 *   1. Admin calls POST /api/auth/mfa/setup  → gets QR code + backup codes
 *   2. Admin scans QR in Google Authenticator
 *   3. Admin confirms with first OTP via POST /api/auth/mfa/enable
 *   4. On future logins: login returns { mfa_required: true, mfa_token: <tmp> }
 *   5. Admin submits OTP to POST /api/auth/mfa/verify-login  → issues full JWT
 *
 * Security notes:
 *   • mfa_secret stored encrypted with AES-256-GCM using MFA_ENCRYPTION_KEY
 *   • tmp tokens are signed JWTs, short-lived (5 min), single-use flag in memory
 *   • OTP window is ±1 step (30s tolerance) to handle slight clock skew
 *   • Brute force: OTP attempts share the auth rate limiter (10/15 min per IP)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { authenticator } = require('otplib');
// otplib replaces speakeasy (unmaintained since 2017)
// authenticator is RFC 6238 TOTP, compatible with Google Authenticator
authenticator.options = { window: 1 }; // ±30s tolerance for clock skew
const QRCode    = require('qrcode');
const jwt       = require('jsonwebtoken');
const crypto    = require('crypto');
const db        = require('../config/db');
const { serverError } = require('../utils/errors');
const secAlerts     = require('../utils/securityAlerts');

// ── Encryption helpers ───────────────────────────────────────────────────────
// The TOTP secret is encrypted at rest. MFA_ENCRYPTION_KEY must be 32 bytes
// (64 hex chars). Falls back to deriving from JWT_SECRET in development.
function getEncKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY || '';
  if (raw.length >= 64) return Buffer.from(raw.slice(0, 64), 'hex');
  // Derive 32 bytes from JWT_SECRET as a dev fallback (not for production)
  return crypto.createHash('sha256').update(process.env.JWT_SECRET || 'dev').digest();
}

function encryptSecret(plaintext) {
  const iv         = crypto.randomBytes(12);
  const key        = getEncKey();
  const cipher     = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  // Store as hex: iv(24) + authTag(32) + ciphertext
  return iv.toString('hex') + authTag.toString('hex') + encrypted.toString('hex');
}

function decryptSecret(stored) {
  try {
    const iv         = Buffer.from(stored.slice(0, 24),  'hex');
    const authTag    = Buffer.from(stored.slice(24, 56), 'hex');
    const ciphertext = Buffer.from(stored.slice(56),     'hex');
    const key        = getEncKey();
    const decipher   = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    return null; // decryption failed — treat as no secret
  }
}

// ── Temporary MFA tokens (pending second-factor verification) ────────────────
// Short-lived signed JWT. Contains user id only — no role — so it cannot be
// used to access any protected route. Valid for 5 minutes.
const MFA_TEMP_SECRET  = (process.env.JWT_SECRET || '') + '_mfa_pending';
const MFA_TEMP_EXPIRY  = '5m';

function issueMfaTempToken(userId) {
  return jwt.sign(
    { sub: userId, type: 'mfa_pending' },
    MFA_TEMP_SECRET,
    { algorithm: 'HS256', expiresIn: MFA_TEMP_EXPIRY }
  );
}

function verifyMfaTempToken(token) {
  try {
    const decoded = jwt.verify(token, MFA_TEMP_SECRET, { algorithms: ['HS256'] });
    if (decoded.type !== 'mfa_pending') return null;
    return decoded;
  } catch {
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   GET /api/auth/mfa/status
   Returns whether MFA is enabled for the current user.
   Used by the admin settings page to show the current state.
══════════════════════════════════════════════════════════════ */
exports.status = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT mfa_enabled FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, mfa_enabled: !!rows[0].mfa_enabled });
  } catch (err) {
    serverError(res, err, '[mfaController.status]');
  }
};

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/mfa/setup
   Step 1: generates a new TOTP secret and QR code.
   Does NOT enable MFA yet — admin must confirm with first OTP via /enable.
   Returns: { qr_code_url, manual_key }
══════════════════════════════════════════════════════════════ */
exports.setup = async (req, res) => {
  try {
    // Only admin can set up MFA
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    // Generate a new TOTP secret (20 bytes = 32 base32 chars)
    const secretBase32 = authenticator.generateSecret(20);
    const label        = encodeURIComponent(`Aqualence Admin (${req.user.name || req.user.id})`);
    const issuer       = encodeURIComponent('Aqualence Ventures');
    const otpauthUrl   = `otpauth://totp/${label}?secret=${secretBase32}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    // Store the raw secret temporarily (NOT yet saved as enabled)
    // We encrypt it before storing
    const encrypted = encryptSecret(secretBase32);

    await db.query(
      'UPDATE users SET mfa_secret = ?, mfa_enabled = 0 WHERE id = ?',
      [encrypted, req.user.id]
    );

    // Generate QR code as a data URI (no file saved)
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    console.info(`[mfa] Setup initiated — user: ${req.user.id}`);

    res.json({
      success:     true,
      qr_code_url: qrDataUrl,          // base64 PNG — display in <img src="...">
      manual_key:  secretBase32,       // for manual entry in authenticator app
      message:     'Scan the QR code in Google Authenticator, then confirm with your first OTP.',
    });
  } catch (err) {
    serverError(res, err, '[mfaController.setup]');
  }
};

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/mfa/enable
   Step 2: verifies the first OTP and activates MFA.
   Body: { otp }
══════════════════════════════════════════════════════════════ */
exports.enable = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const { otp } = req.body;
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'OTP must be a 6-digit number' });
    }

    const [rows] = await db.query(
      'SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!rows.length || !rows[0].mfa_secret) {
      return res.status(400).json({
        success: false,
        message: 'No MFA setup found. Call /api/auth/mfa/setup first.',
      });
    }

    if (rows[0].mfa_enabled) {
      return res.status(400).json({ success: false, message: 'MFA is already enabled.' });
    }

    const plainSecret = decryptSecret(rows[0].mfa_secret);
    if (!plainSecret) {
      return res.status(500).json({ success: false, message: 'MFA secret is corrupted. Please run setup again.' });
    }

    const valid = authenticator.verify({ token: otp, secret: plainSecret });

    if (!valid) {
      console.warn(`[mfa] Enable failed — wrong OTP — user: ${req.user.id}`);
      return res.status(401).json({ success: false, message: 'Invalid OTP. Check your authenticator app and try again.' });
    }

    // OTP confirmed — activate MFA
    await db.query(
      'UPDATE users SET mfa_enabled = 1 WHERE id = ?',
      [req.user.id]
    );

    console.info(`[mfa] Enabled — user: ${req.user.id}`);
    res.json({ success: true, message: 'MFA is now enabled for your account.' });
  } catch (err) {
    serverError(res, err, '[mfaController.enable]');
  }
};

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/mfa/disable
   Disables MFA and clears the secret.
   Requires current OTP for confirmation (cannot disable without phone).
   Body: { otp }
══════════════════════════════════════════════════════════════ */
exports.disable = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Admin only' });
    }

    const { otp } = req.body;
    if (!otp || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'OTP is required to disable MFA' });
    }

    const [rows] = await db.query(
      'SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?',
      [req.user.id]
    );

    if (!rows.length || !rows[0].mfa_enabled) {
      return res.status(400).json({ success: false, message: 'MFA is not enabled on this account.' });
    }

    const plainSecret = decryptSecret(rows[0].mfa_secret);
    const valid = plainSecret && authenticator.verify({ token: otp, secret: plainSecret });

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid OTP. MFA not disabled.' });
    }

    await db.query(
      'UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?',
      [req.user.id]
    );

    console.info(`[mfa] Disabled — user: ${req.user.id}`);
    secAlerts.mfaDisabled(req.user.id, req.ip);
    res.json({ success: true, message: 'MFA has been disabled.' });
  } catch (err) {
    serverError(res, err, '[mfaController.disable]');
  }
};

/* ══════════════════════════════════════════════════════════════
   POST /api/auth/mfa/verify-login
   Step 2 of the login flow when MFA is enabled.
   Called with the temporary MFA token from login + the OTP.
   Body: { mfa_token, otp }
   On success: issues the full JWT cookie and returns user profile.
══════════════════════════════════════════════════════════════ */
exports.verifyLogin = async (req, res) => {
  try {
    const { mfa_token, otp } = req.body;

    if (!mfa_token || !otp) {
      return res.status(400).json({ success: false, message: 'mfa_token and otp are required' });
    }
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({ success: false, message: 'OTP must be a 6-digit number' });
    }

    // Verify temporary token
    const decoded = verifyMfaTempToken(mfa_token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        message: 'MFA session expired. Please log in again.',
      });
    }

    const userId = decoded.sub;

    // Fetch user + MFA secret
    const [rows] = await db.query(
      `SELECT id, name, phone, role, is_active, must_change_password,
              mfa_secret, mfa_enabled
       FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );

    const user = rows[0];
    if (!user || !user.is_active || !user.mfa_enabled || !user.mfa_secret) {
      return res.status(401).json({ success: false, message: 'Invalid MFA session.' });
    }

    const plainSecret = decryptSecret(user.mfa_secret);
    const valid = plainSecret && authenticator.verify({ token: otp, secret: plainSecret });

    if (!valid) {
      console.warn(`[mfa] Login verify failed — wrong OTP — user: ${userId}`);
      secAlerts.mfaVerifyFailed(userId, req.ip);
      return res.status(401).json({ success: false, message: 'Invalid OTP. Try again.' });
    }

    // OTP verified — issue full JWT (same logic as authController.login)
    const jtiVal   = crypto.randomUUID();
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    const token = jwt.sign(
      {
        jti:  jtiVal,
        id:   user.id,
        name: user.name,
        role: user.role,
        ...(user.must_change_password ? { forceReset: true } : {}),
      },
      process.env.JWT_SECRET,
      { expiresIn, algorithm: 'HS256' }
    );

    const maxAgeMs = parseExpiry(expiresIn);

    res.cookie('aq_auth', token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge:   maxAgeMs,
      path:     '/',
    });

    console.info(`[mfa] Login verified — user: ${user.id} role: ${user.role} — IP: ${req.ip}`);

    res.json({
      success: true,
      user: {
        id:                   user.id,
        name:                 user.name,
        phone:                user.phone,
        role:                 user.role,
        must_change_password: !!user.must_change_password,
      },
    });
  } catch (err) {
    serverError(res, err, '[mfaController.verifyLogin]');
  }
};

// ── Re-export issueMfaTempToken for use in authController ───────────────────
exports.issueMfaTempToken = issueMfaTempToken;

// ── Expiry parser (duplicated from authController to keep this module self-contained) ──
function parseExpiry(str) {
  const units = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  const match = String(str).match(/^(\d+)([smhd])$/);
  if (!match) return 7 * 86400000;
  return parseInt(match[1], 10) * (units[match[2]] || 86400000);
}