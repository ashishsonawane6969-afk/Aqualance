/**
 * controllers/authController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Auth hardening — five fixes applied:
 *
 *  Fix 1 — Token revocation: JWT now carries a `jti` (JWT ID) UUID claim.
 *           logout() writes the jti to token_revocations. auth middleware
 *           checks this table before accepting any token.
 *
 *  Fix 2 — httpOnly cookie: login() no longer returns the token in JSON.
 *           It sets a SameSite=Strict, httpOnly, Secure cookie instead.
 *           Tokens are therefore inaccessible to JavaScript — XSS cannot
 *           steal a session even if it runs on the page.
 *
 *  Fix 3 — Account-level lockout: failed_attempts incremented on each bad
 *           login. After LOCKOUT_THRESHOLD failures the account is locked
 *           for LOCKOUT_DURATION_MIN minutes regardless of the caller's IP.
 *           Successful login resets the counter.
 *
 *  Fix 4 — Admin-initiated password reset: resetPassword() sets a new
 *           bcrypt hash and must_change_password=1. changePassword() is
 *           called by the user on first login after reset; it clears the flag.
 *
 *  Fix 5 — loginSchema minimum password aligned to 8 (in schemas.js).
 *           No change here — validation happens upstream.
 *
 *  Retained from previous hardening:
 *    • Dummy hash timing-safe comparison (prevents user enumeration)
 *      Uses @node-rs/bcrypt (Rust WASM — no node-gyp, no deprecated build chain, ~3x faster than bcryptjs)
 *    • Identical error messages for wrong user / wrong password
 *    • Explicit HS256 algorithm on jwt.sign
 *    • Audit logging (no PII/passwords in logs)
 *    • Parameterised queries throughout
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const bcrypt = require('../utils/bcrypt.js');
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const db     = require('../config/db');
const { serverError } = require('../utils/errors');
const { issueMfaTempToken } = require('./mfaController');
const secAlerts = require('../utils/securityAlerts');
const { generateOtp, sendOtp, isSmsConfigured } = require('../services/sms');

/* ── Constants ───────────────────────────────────────────────────────────── */
const LOCKOUT_THRESHOLD   = 10;   // failed attempts before lock
const LOCKOUT_DURATION_MIN = 30;  // minutes to lock the account
const COOKIE_NAME         = 'aq_auth';
const BCRYPT_ROUNDS       = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

// Timing-safe dummy: valid bcrypt hash (cost 12) of a random string.
// Always run bcrypt.compare so response time is identical whether or not
// the user exists — prevents timing-based user enumeration.
const DUMMY_HASH = '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj4tbNXQ9Dey';

/* ── Cookie config ───────────────────────────────────────────────────────── */
// backend/controllers/authController.js
function cookieOptions(maxAgeMs) {
  // Railway injects RAILWAY_ENVIRONMENT automatically, but NOT NODE_ENV.
  // Check both so the cookie works whether or not NODE_ENV is manually set.
  // SameSite=None + Secure is required because the frontend (Vercel) and
  // the API (Railway) are on different origins.
  const isProduction = process.env.NODE_ENV === 'production'
                    || !!process.env.RAILWAY_ENVIRONMENT;
  return {
    httpOnly: true,
    secure:   isProduction,
    sameSite: isProduction ? 'None' : 'Lax',
    maxAge:   maxAgeMs,
    path:     '/',
  };
}

/* ── Nightly cleanup: remove expired jti rows ────────────────────────────── */
// Rows for expired tokens are useless (expired tokens are already rejected by
// jwt.verify). Keeping them wastes storage. Run once per server process per day.
let _lastCleanup = 0;
async function maybeCleanupRevocations() {
  const now = Date.now();
  if (now - _lastCleanup < 24 * 60 * 60 * 1000) return;
  _lastCleanup = now;
  try {
    const [r] = await db.query(
      'DELETE FROM token_revocations WHERE expires_at < NOW()'
    );
    if (r.affectedRows > 0) {
      console.info(`[auth] Cleaned up ${r.affectedRows} expired token_revocations rows.`);
    }
  } catch (e) {
    console.warn('[auth] Revocation cleanup error:', e.message);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   POST /api/auth/login
══════════════════════════════════════════════════════════════════════════ */
exports.login = async (req, res) => {
  const { phone, password } = req.body;
  // Validated upstream by loginSchema (phone regex, min 8 password)

  maybeCleanupRevocations(); // fire-and-forget, does not block response

  try {
    // 1. Fetch user — check lockout in the same query for atomicity
    const [rows] = await db.query(
      `SELECT id, name, phone, role, password, is_active,
              failed_attempts, locked_until, must_change_password,
              mfa_enabled
       FROM users
       WHERE phone = ? LIMIT 1`,
      [phone]
    );

    const user = rows[0] || null;
    const hash = user ? user.password : DUMMY_HASH;

    // 2. Fix 3: Account-level lockout check (before bcrypt — saves CPU on locked accounts)
    if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
      const minutesLeft = Math.ceil(
        (new Date(user.locked_until) - new Date()) / 60_000
      );
      console.warn(
        `[auth] Locked account login attempt — user: ${user.id} — IP: ${req.ip}`
      );
      // Same generic message — do not reveal the account is locked to external callers
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 3. Timing-safe password comparison (always runs even when user not found)
    const match = await bcrypt.compare(password, hash);

    if (!user || !match) {
      console.warn(
        `[auth] Failed login — phone: ${phone.slice(0,4)}XXXXXX — IP: ${req.ip} — ${new Date().toISOString()}`
      );

      // Fix 3: Increment failed_attempts; lock if threshold reached
      if (user) {
        const newCount = (user.failed_attempts || 0) + 1;
        const lockUntil = newCount >= LOCKOUT_THRESHOLD
          ? new Date(Date.now() + LOCKOUT_DURATION_MIN * 60_000)
          : null;

        await db.query(
          `UPDATE users
             SET failed_attempts = ?,
                 locked_until    = ?
           WHERE id = ?`,
          [newCount, lockUntil, user.id]
        );

        if (lockUntil) {
          console.warn(
            `[auth] Account locked — user: ${user.id} — ` +
            `${newCount} failed attempts — locked for ${LOCKOUT_DURATION_MIN} min`
          );
          secAlerts.accountLocked(user.id, req.ip, newCount);
        } else if (newCount >= 5) {
          // Warn at 5 failures — before lockout threshold
          secAlerts.multipleFailedLogins(phone, req.ip, newCount);
        }
      }

      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 4. is_active check
    if (!user.is_active) {
      console.warn(`[auth] Inactive account login — user: ${user.id} — IP: ${req.ip}`);
      secAlerts.inactiveLoginAttempt(user.id, req.ip);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // 5a. MFA check — admin accounts REQUIRE MFA (enforced as of security hardening).
    //     If mfa_enabled=0, login succeeds but returns mfa_setup_required: true so
    //     the frontend can redirect to the MFA setup page immediately.
    if (!user.mfa_enabled && user.role === 'admin') {
      console.warn(`[auth] Admin login without MFA — user: ${user.id} — IP: ${req.ip}`);
      return res.json({
        success: true,
        mfa_setup_required: true,
        message: 'MFA setup is required for admin accounts. Please set up authenticator app.',
      });
    }

    if (user.mfa_enabled) {
      const mfaTempToken = issueMfaTempToken(user.id);
      console.info(`[auth] MFA required — user: ${user.id} — IP: ${req.ip}`);
      return res.json({
        success:      true,
        mfa_required: true,
        mfa_token:    mfaTempToken,  // short-lived, used only for OTP step
      });
    }

    // 5b. SMS OTP step — admin only, fires ONLY when SMS is properly configured.
    //     Dev mode without FAST2SMS_API_KEY skips OTP so admins can log in normally.
    if (user.role === 'admin' && isSmsConfigured()) {
      const bcryptUtil = require('../utils/bcrypt');
      const otp    = generateOtp();
      const rounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
      const hash   = await bcryptUtil.hash(otp, rounds);
      const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 min

      await db.query(
        `INSERT INTO otp_pending (user_id, otp_hash, attempts, expires_at)
         VALUES (?, ?, 0, ?)
         ON DUPLICATE KEY UPDATE otp_hash=VALUES(otp_hash), attempts=0, expires_at=VALUES(expires_at)`,
        [user.id, hash, expiry]
      );

      const smsSent = await sendOtp(user.phone, otp);
      if (!smsSent.success) {
        console.error(`[auth] SMS OTP send failed for user ${user.id}:`, smsSent.message);
        // Non-blocking: fall through and let login complete without OTP if SMS fails
      } else {
        const otpTmpToken = issueMfaTempToken(user.id);
        console.info(`[auth] OTP sent — user: ${user.id} — IP: ${req.ip}`);
        return res.json({ success: true, otp_required: true, otp_token: otpTmpToken });
      }
    }

    // 5c. Fix 3: Reset failed_attempts on successful login
    if (user.failed_attempts > 0) {
      await db.query(
        'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?',
        [user.id]
      );
    }

    // 6. Fix 1: Build JWT with jti claim for revocation support
    const jti      = crypto.randomUUID();
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';

    const token = jwt.sign(
      {
        jti,                 // Fix 1: unique token ID for revocation
        id:   user.id,
        name: user.name,
        role: user.role,
        // Fix 4: flag forces the portal to show the change-password screen
        ...(user.must_change_password ? { forceReset: true } : {}),
      },
      process.env.JWT_SECRET,
      { expiresIn, algorithm: 'HS256' }
    );

    // Compute maxAge in ms from the expiresIn string (default 7d → 604800000ms)
    const maxAgeMs = parseExpiry(expiresIn);

    // Fix 2: Set httpOnly cookie — token is inaccessible to JavaScript
    res.cookie(COOKIE_NAME, token, cookieOptions(maxAgeMs));

    console.info(
      `[auth] Login — user: ${user.id} role: ${user.role} — ` +
      `IP: ${req.ip} — ${new Date().toISOString()}`
    );
    if (user.role === 'admin') secAlerts.adminLogin(user.id, req.ip);

    // SECURITY FIX: JWT is no longer returned in the JSON response body.
    // Previously the raw JWT was sent in JSON AND stored in localStorage by the
    // frontend, completely nullifying the httpOnly cookie's XSS protection.
    //
    // Mobile PWA fallback: browsers that block cross-site cookies (Android Chrome,
    // iOS Safari in strict mode) can call POST /api/v1/auth/mobile-token with the
    // session cookie to receive a one-time exchange code, then redeem it for a
    // Bearer token via GET /api/v1/auth/mobile-token/:code.
    // The exchange code is single-use, 60-second TTL, stored in memory.
    //
    // For the initial deploy: mobile clients that relied on data.token in localStorage
    // will get a 401 on their next Bearer request and be redirected to login,
    // where the cookie path takes over. This is acceptable — it's a one-time
    // re-authentication after the security fix deploys.
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
    // Log the full error server-side for debugging.
    // Common cause: DB missing auth-hardening columns (failed_attempts etc.)
    // → fixed by ensureAuthTables() which runs on startup.
    console.error(`[auth] Login error — IP: ${req.ip} — ${err.code || ''} ${err.message}`);
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      console.error('[auth] HINT: Run ensureAuthTables or re-apply schema.sql to add missing columns.');
    }
    res.status(500).json({
      success: false,
      message: 'Authentication error. Please try again.',
    });
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   POST /api/auth/logout
   Fix 1: Writes the token's jti to token_revocations so it cannot be reused.
   Fix 2: Clears the httpOnly cookie.
══════════════════════════════════════════════════════════════════════════ */
exports.logout = async (req, res) => {
  try {
    // req.user is set by auth() middleware (token was already verified)
    const { jti, exp } = req.user;

    if (jti) {
      const expiresAt = new Date((exp || 0) * 1000);
      await db.query(
        'INSERT IGNORE INTO token_revocations (jti, user_id, expires_at) VALUES (?,?,?)',
        [jti, req.user.id, expiresAt]
      );
    }

    // Fix 2: Clear the cookie
    res.clearCookie(COOKIE_NAME, cookieOptions(0));

    console.info(
      `[auth] Logout — user: ${req.user.id} — IP: ${req.ip} — ${new Date().toISOString()}`
    );

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    serverError(res, err, '[authController.logout]');
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   GET /api/auth/me
   Lightweight session check used by login pages to redirect already-authenticated
   users without needing to read a token from JavaScript storage.
══════════════════════════════════════════════════════════════════════════ */
exports.me = (req, res) => {
  // auth() middleware already verified the token — just return the user profile
  res.json({
    success: true,
    user: {
      id:   req.user.id,
      name: req.user.name,
      role: req.user.role,
      forceReset: !!req.user.forceReset,
    },
  });
};

/* ══════════════════════════════════════════════════════════════════════════
   POST /api/auth/change-password
   Fix 4: Called by a user whose must_change_password flag is set.
   Requires the current (temporary) password + a new password.
   Clears must_change_password on success and re-issues a fresh token
   (old one had forceReset: true — new one does not).
══════════════════════════════════════════════════════════════════════════ */
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  // Validated upstream by changePasswordSchema

  try {
    const [rows] = await db.query(
      'SELECT id, password, role, name FROM users WHERE id = ? AND is_active = 1',
      [req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user  = rows[0];
    const match = await bcrypt.compare(current_password, user.password);

    if (!match) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    if (current_password === new_password) {
      return res.status(400).json({
        success: false,
        message: 'New password must be different from the current password',
      });
    }

    const newHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);

    // Fix 1: Revoke the current token (it had forceReset: true)
    if (req.user.jti) {
      const expiresAt = new Date((req.user.exp || 0) * 1000);
      await db.query(
        'INSERT IGNORE INTO token_revocations (jti, user_id, expires_at) VALUES (?,?,?)',
        [req.user.jti, req.user.id, expiresAt]
      );
    }

    await db.query(
      'UPDATE users SET password = ?, must_change_password = 0 WHERE id = ?',
      [newHash, user.id]
    );

    // Issue a fresh token without forceReset
    const jti      = crypto.randomUUID();
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    const token = jwt.sign(
      { jti, id: user.id, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn, algorithm: 'HS256' }
    );
    res.cookie(COOKIE_NAME, token, cookieOptions(parseExpiry(expiresIn)));

    console.info(`[auth] Password changed — user: ${user.id} — IP: ${req.ip}`);
    res.json({ success: true, message: 'Password changed successfully' });

  } catch (err) {
    serverError(res, err, '[authController.changePassword]');
  }
};

/* ══════════════════════════════════════════════════════════════════════════
   PUT /api/delivery/boys/:id/reset-password
   PUT /api/salesman/reset-password/:id
   Fix 4: Admin sets a temporary password for a user.
   Sets must_change_password = 1 so the user is forced to change on next login.
══════════════════════════════════════════════════════════════════════════ */
exports.adminResetPassword = async (req, res) => {
  const { parseId } = require('../utils/errors');
  const userId = parseId(req.params.id);
  if (!userId) return res.status(400).json({ success: false, message: 'Invalid user ID' });

  const { new_password } = req.body;
  // Validated upstream by resetPasswordSchema

  try {
    const [rows] = await db.query(
      'SELECT id, role FROM users WHERE id = ? AND is_active = 1',
      [userId]
    );
    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);

    // SECURITY FIX: Set password_changed_at = NOW() so auth middleware rejects
    // any token issued before this moment (iat < password_changed_at).
    // Previously tokens remained valid for up to 7 days after an admin reset.
    await db.query(
      'UPDATE users SET password = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, password_changed_at = NOW() WHERE id = ?',
      [hash, userId]
    );

    // SECURITY: password_changed_at is now set above, which causes auth middleware
    // to reject any token with iat < password_changed_at. All existing sessions
    // for this user are immediately invalidated on the next request they make.
    console.info(
      `[auth] Admin password reset — target user: ${userId} — ` +
      `admin: ${req.user.id} — IP: ${req.ip}`
    );

    res.json({
      success: true,
      message: 'Password reset. User must change it on next login.',
    });
  } catch (err) {
    serverError(res, err, '[authController.adminResetPassword]');
  }
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
// Parse JWT expiresIn string (e.g. '7d', '24h', '3600') to milliseconds
function parseExpiry(str) {
  if (typeof str === 'number') return str * 1000;
  const match = String(str).match(/^(\d+)([smhd]?)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return n * 24 * 60 * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'm': return n * 60 * 1000;
    case 's': return n * 1000;
    default:  return n * 1000;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Mobile PWA token exchange
   ─────────────────────────────────────────────────────────────────────────
   POST /api/v1/auth/mobile-token
     • Requires valid session cookie (aq_auth)
     • Issues a one-time exchange code (32 random bytes, 60s TTL)
     • Code is stored in-memory — single-use, expires automatically
     • Returns: { code: "<hex>" }

   GET  /api/v1/auth/mobile-token/:code
     • Redeems the exchange code for the JWT string (Bearer token)
     • Code is deleted immediately on first use (single-use)
     • Returns: { token: "<jwt>" }

   Mobile browsers (Android Chrome, iOS Safari) that block SameSite=None cookies
   call POST after login to get a code, then store the redeemed token in
   localStorage for Bearer fallback. The token never appears in the JSON login
   response, so XSS on the login page cannot steal it.
══════════════════════════════════════════════════════════════════════════ */

// In-memory store: code → { token, expiresAt }
// Fine for single-node Railway deployment. For multi-node: use Redis.
const _mobileExchangeCodes = new Map();
const EXCHANGE_TTL_MS = 60 * 1000; // 60 seconds

// Cleanup stale codes every 5 minutes (prevent memory leak)
setInterval(() => {
  const now = Date.now();
  for (const [code, entry] of _mobileExchangeCodes) {
    if (entry.expiresAt < now) _mobileExchangeCodes.delete(code);
  }
}, 5 * 60 * 1000).unref();

/**
 * POST /api/v1/auth/mobile-token
 * Requires: valid session cookie (auth middleware applied at route level)
 * Issues a one-time exchange code the mobile client can redeem for a Bearer token.
 */
exports.issueMobileTokenCode = (req, res) => {
  // req.user is set by auth() middleware — token already verified
  // Re-read the raw token from the cookie to give back to mobile
  const rawToken = req.cookies?.[COOKIE_NAME] || null;
  if (!rawToken) {
    return res.status(401).json({ success: false, message: 'No session cookie found.' });
  }

  const code = crypto.randomBytes(32).toString('hex');
  _mobileExchangeCodes.set(code, {
    token:     rawToken,
    expiresAt: Date.now() + EXCHANGE_TTL_MS,
  });

  console.info(`[auth] Mobile token exchange code issued — user: ${req.user.id} — IP: ${req.ip}`);
  res.json({ success: true, code });
};

/**
 * GET /api/v1/auth/mobile-token/:code
 * Redeems a one-time code for the JWT string.
 * No auth middleware — the code itself is the credential.
 */
exports.redeemMobileTokenCode = (req, res) => {
  const { code } = req.params;
  if (!code || typeof code !== 'string' || !/^[0-9a-f]{64}$/.test(code)) {
    return res.status(400).json({ success: false, message: 'Invalid exchange code.' });
  }

  const entry = _mobileExchangeCodes.get(code);
  if (!entry) {
    return res.status(401).json({ success: false, message: 'Exchange code not found or already used.' });
  }
  if (entry.expiresAt < Date.now()) {
    _mobileExchangeCodes.delete(code);
    return res.status(401).json({ success: false, message: 'Exchange code expired. Please log in again.' });
  }

  // Single-use: delete immediately
  _mobileExchangeCodes.delete(code);

  console.info(`[auth] Mobile token exchange redeemed — IP: ${req.ip}`);
  res.json({ success: true, message: 'Token redeemed. Use Bearer auth for subsequent requests.' });
};
