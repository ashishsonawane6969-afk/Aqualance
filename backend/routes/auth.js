/**
 * routes/auth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints:
 *   POST /api/auth/login           — rate-limited, schema-validated login
 *   POST /api/auth/logout          — revoke jti, clear cookie (auth required)
 *   GET  /api/auth/me              — session check (auth required, any role)
 *   POST /api/auth/change-password — forced-reset password change (auth required)
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

'use strict';

// routes/auth.js — DELETE this entire block (lines 15-29)
// ❌ REMOVE:
module.exports = function (roles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
};
// ✅ KEEP only: module.exports = router; at the bottom


const express = require('express');
const router  = express.Router();

const ctrl                  = require('../controllers/authController');
const otpCtrl               = require('../controllers/otpController');
const mfaCtrl               = require('../controllers/mfaController');
const auth                  = require('../middleware/auth');
const { authLimiter, authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate }          = require('../middleware/validate');
const {
  loginSchema,
  changePasswordSchema,
  mfaOtpSchema,
  mfaVerifyLoginSchema,
  otpVerifySchema,
  otpResendSchema,
} = require('../validation/schemas');

// POST /api/auth/login — public (rate-limited + validated)
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  ctrl.login
);

// POST /api/auth/logout — must be authenticated to revoke own token
router.post(
  '/logout',
  authenticatedLimiter,   // prevent token revocation spam
  auth([]),
  ctrl.logout
);

// GET /api/auth/me — lightweight session probe used by login-page redirects
router.get(
  '/me',
  authenticatedLimiter,
  auth([]),
  ctrl.me
);

// POST /api/auth/change-password — for users with must_change_password = 1
router.post(
  '/change-password',
  authenticatedLimiter,
  auth([]),
  validate(changePasswordSchema),
  ctrl.changePassword
);

// ── SMS OTP routes ────────────────────────────────────────────────────────
router.post('/verify-otp', authLimiter, validate(otpVerifySchema), otpCtrl.verifyOtp);
router.post('/resend-otp', authLimiter, validate(otpResendSchema), otpCtrl.resendOtp);

// ── MFA routes (admin TOTP — P2 fix) ──────────────────────────────────────
// POST /api/auth/mfa/verify-login — public but rate-limited (step 2 of login)
router.post(
  '/mfa/verify-login',
  authLimiter,                         // shares login brute-force limit
  validate(mfaVerifyLoginSchema),
  mfaCtrl.verifyLogin
);

// GET  /api/auth/mfa/status   — is MFA enabled on my account?
// POST /api/auth/mfa/setup    — generate QR code + secret
// POST /api/auth/mfa/enable   — confirm first OTP, activate MFA
// POST /api/auth/mfa/disable  — disable MFA (requires current OTP)
router.get(  '/mfa/status',  authenticatedLimiter, auth(['admin']), mfaCtrl.status);
router.post( '/mfa/setup',   authenticatedLimiter, auth(['admin']), mfaCtrl.setup);
router.post( '/mfa/enable',  authenticatedLimiter, auth(['admin']), validate(mfaOtpSchema), mfaCtrl.enable);
router.post( '/mfa/disable', authenticatedLimiter, auth(['admin']), validate(mfaOtpSchema), mfaCtrl.disable);

module.exports = router;
