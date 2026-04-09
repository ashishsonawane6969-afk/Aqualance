/**
 * middleware/rateLimiter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * OWASP A05 – Security Misconfiguration / A04 – Insecure Design
 *
 * Tiered rate limiting strategy using express-rate-limit (in-memory store).
 * For production with multiple nodes, swap `windowMs` store to Redis via
 * `rate-limit-redis` — the API surface is identical, only the constructor
 * changes.
 *
 * Tiers (all keyed by req.ip, which Express resolves via trust proxy):
 *
 *   ┌────────────────────┬──────────┬──────────────────────────────────────┐
 *   │  Limiter           │ Max reqs │ Window   │ Applies to                 │
 *   ├────────────────────┼──────────┼──────────┼────────────────────────────┤
 *   │  globalLimiter     │  300     │  15 min  │ Every route (baseline)     │
 *   │  authLimiter       │   10     │  15 min  │ POST /api/auth/login        │
 *   │  publicWriteLimiter│   20     │   1 hr   │ POST /api/orders (guest)    │
 *   │  authenticatedLimit│  200     │   5 min  │ All authenticated routes    │
 *   │  mapsKeyLimiter    │   30     │   1 hr   │ GET /api/config/maps-key    │
 *   └────────────────────┴──────────┴──────────┴────────────────────────────┘
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const rateLimit = require('express-rate-limit');

/* ── Shared 429 response handler ─────────────────────────────────────────── */
function onLimitReached(req, res, _options) {
  // OWASP: never expose internal state; keep message vague
  res.status(429).json({
    success: false,
    message: 'Too many requests — please slow down and try again later.',
    // retryAfter is already set as a Retry-After header by express-rate-limit
  });
}

/* ── Key generator: prefer X-Forwarded-For when behind a trusted proxy ───── */
// Set `app.set('trust proxy', 1)` in server.js when behind nginx/load-balancer.
function keyGenerator(req) {
  return req.ip; // Express normalises this from X-Forwarded-For if trust proxy is set
}

/* ── 1. Global baseline limiter ──────────────────────────────────────────── */
const globalLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              300,             // 300 requests per 15-minute window per IP
  standardHeaders:  'draft-7',      // RateLimit header (RFC 6585)
  legacyHeaders:    false,
  keyGenerator,
  handler:          onLimitReached,
  // Skip successful OPTIONS (preflight) requests from count
  skip: (req) => req.method === 'OPTIONS',
  message: 'Too many requests',
});

/* ── 2. Auth limiter — brute-force protection on login ───────────────────── */
const authLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,              // 10 login attempts per 15 min (brute-force protection)
  standardHeaders:  'draft-7',
  legacyHeaders:    false,
  keyGenerator,
  handler:          onLimitReached,
  skip: (req, res) => res.statusCode < 400 || res.statusCode >= 500,
  message: 'Too many login attempts',
});

/* ── 3. Public write limiter — guest order placement ─────────────────────── */
const publicWriteLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,  // 1 hour
  max:             20,               // 20 guest orders per hour per IP
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  keyGenerator,
  handler:         onLimitReached,
  message: 'Too many order submissions',
});

/* ── 4. Authenticated API limiter — protect admin/delivery/salesman routes ─ */
const authenticatedLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,   // 5 minutes
  max:             200,              // 200 authenticated requests per 5-minute window
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  keyGenerator,
  handler:         onLimitReached,
  message: 'Too many API requests',
});

/* ── 5. Maps key endpoint limiter ────────────────────────────────────────── */
const mapsKeyLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,  // 1 hour
  max:             30,               // 30 map-key requests per hour
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  keyGenerator,
  handler:         onLimitReached,
  message: 'Too many configuration requests',
});

module.exports = {
  globalLimiter,
  authLimiter,
  publicWriteLimiter,
  authenticatedLimiter,
  mapsKeyLimiter,
};
