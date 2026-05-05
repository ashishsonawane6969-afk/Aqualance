'use strict';
/**
 * middleware/csrf.js — Double-submit cookie CSRF protection
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NEEDED:
 *   Session cookies are set with SameSite=None (required because the frontend on
 *   Vercel and the API on Railway are on different origins). SameSite=None means
 *   the cookie is sent on ALL cross-origin requests — including forged ones from
 *   attacker-controlled pages. Combined with the CORS null-origin bypass, CSRF is
 *   a real attack vector without this protection.
 *
 * PATTERN: Double-Submit Cookie
 *   1. On any GET request (or when the cookie is absent), the server sets a
 *      `aq_csrf` cookie (non-httpOnly, SameSite=Strict, Secure in production).
 *   2. For every state-changing request (POST/PUT/PATCH/DELETE), the client
 *      must include the same value in the `X-CSRF-Token` header.
 *   3. Middleware compares the cookie value to the header value.
 *      Mismatch → 403. Match → next().
 *
 * WHY THIS WORKS:
 *   An attacker's page can trigger a cross-origin request that sends cookies,
 *   but CANNOT read the Set-Cookie response from our domain (SOP). Therefore
 *   the attacker cannot know the CSRF token value and cannot set the header.
 *
 * EXEMPT ROUTES (no CSRF check needed):
 *   • GET/HEAD/OPTIONS — read-only, no state change
 *   • POST /api/v1/orders — public guest endpoint (no session cookie, no CSRF risk)
 *   • POST /api/v1/auth/login — pre-session, no cookie exists yet
 *   • POST /api/v1/ai/chat — public AI chat (no session)
 *   • GET  /api/v1/auth/mobile-token/:code — code itself is the credential
 * ─────────────────────────────────────────────────────────────────────────────
 */

const crypto = require('crypto');

const CSRF_COOKIE  = 'aq_csrf';
const CSRF_HEADER  = 'x-csrf-token';
const TOKEN_BYTES  = 32;

// Routes exempt from CSRF verification (public / pre-auth endpoints)
const CSRF_EXEMPT = new Set([
  '/api/v1/orders',            // public guest order — no session
  '/api/v1/auth/login',        // pre-session — no cookie exists yet
  '/api/v1/auth/verify-otp',   // pre-session OTP step
  '/api/v1/auth/resend-otp',   // pre-session OTP step
  '/api/v1/auth/mfa/verify-login', // pre-session MFA step
  '/api/v1/ai/chat',           // public AI endpoint — no session
]);

// Also exempt any GET /api/v1/auth/mobile-token/:code
function isExempt(req) {
  const method = req.method.toUpperCase();
  // Safe methods never mutate state
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  // Exact path exemptions
  if (CSRF_EXEMPT.has(req.path)) return true;
  // Mobile token redeem — GET only (already exempt via method check above)
  return false;
}

/**
 * csrf() — Express middleware
 *
 * Step 1 (cookie provisioning): On every request, if aq_csrf cookie is absent
 * or empty, generate a new token and set it. This ensures the cookie is always
 * present after the first GET.
 *
 * Step 2 (verification): On state-changing requests that are not exempt,
 * compare cookie value to X-CSRF-Token header. Mismatch → 403.
 */
function csrf(req, res, next) {
  const isProduction = process.env.NODE_ENV === 'production'
                    || !!process.env.RAILWAY_ENVIRONMENT;

  // Step 1: provision cookie if missing
  let csrfToken = req.cookies?.[CSRF_COOKIE] || '';
  if (!csrfToken || csrfToken.length < 32) {
    csrfToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,     // MUST be readable by JS so the frontend can send it as a header
      secure:   isProduction,
      sameSite: 'Strict',  // Never sent cross-origin — attacker cannot forge this cookie
      path:     '/',
      maxAge:   24 * 60 * 60 * 1000, // 24 hours — refreshed on each page load
    });
  }

  // Step 2: verify on state-changing requests
  if (!isExempt(req)) {
    const headerToken = req.headers[CSRF_HEADER] || '';
    if (!headerToken || headerToken !== csrfToken) {
      return res.status(403).json({
        success: false,
        message: 'CSRF token mismatch. Please refresh the page and try again.',
      });
    }
  }

  next();
}

module.exports = csrf;
