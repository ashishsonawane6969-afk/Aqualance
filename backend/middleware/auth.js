/**
 * middleware/auth.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Auth hardening fixes applied:
 *
 *  Fix 1 — Token revocation: after verifying signature, checks the jti
 *           against token_revocations. Any revoked token is rejected with 401.
 *
 *  Fix 2 — Cookie-first: reads the token from the httpOnly cookie (aq_auth)
 *           rather than the Authorization header. Falls back to the header for
 *           backward compatibility during any transition period, but the cookie
 *           path is the canonical one.
 *
 *  Retained:
 *    • HS256 algorithm enforcement (prevents alg:none and RS256 confusion attacks)
 *    • Granular JWT error classification (Expired / Invalid / NotBefore)
 *    • Role-based access control
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const jwt = require('jsonwebtoken');
const db  = require('../config/db');

const COOKIE_NAME = 'aq_auth';

function auth(roles = []) {
  return async (req, res, next) => {
    // Fix 2: Read token from httpOnly cookie first, fall back to Bearer header.
    // The cookie is the secure path — the header fallback supports the maps-key
    // endpoint and any non-browser API clients (e.g. mobile app, curl).
    let token = req.cookies?.[COOKIE_NAME] || null;

    if (!token) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        token = header.split(' ')[1];
      }
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }

    try {
      // Verify signature + expiry. HS256 is enforced — alg:none is rejected.
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        algorithms: ['HS256'],
      });

      // Fix 1: Check revocation table if the token has a jti claim.
      // Tokens issued before Fix 1 won't have jti — they pass through
      // (they'll naturally expire within 7 days of the deploy).
      if (decoded.jti) {
        const [rows] = await db.query(
          'SELECT jti FROM token_revocations WHERE jti = ? LIMIT 1',
          [decoded.jti]
        );
        if (rows.length > 0) {
          return res.status(401).json({
            success: false,
            message: 'Session expired. Please log in again.',
          });
        }
      }

      req.user = decoded;

      // RBAC: check role if the route requires one
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: insufficient role',
        });
      }

      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Session expired. Please log in again.',
        });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token. Please log in again.',
        });
      }
      if (err.name === 'NotBeforeError') {
        return res.status(401).json({
          success: false,
          message: 'Token not yet valid.',
        });
      }
      console.error('[auth] Unexpected JWT error:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Authentication error. Try again.',
      });
    }
  };
}

module.exports = auth;
