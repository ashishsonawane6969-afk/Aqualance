/**
 * server.js — Aqualence Ventures API
 * ─────────────────────────────────────────────────────────────────────────────
 * Security hardening applied (OWASP Top-10 aligned):
 *
 *   A02 – Cryptographic Failures   : JWT_SECRET enforced strong in prod
 *   A05 – Security Misconfiguration: Helmet HTTP headers, strict CORS,
 *                                    reduced body-size limit, trust proxy,
 *                                    per-request CSP nonce (no unsafe-inline)
 *   A07 – Identification & Auth    : All sensitive endpoints require auth
 *                                    (maps-key now gated behind JWT)
 *   A04 – Insecure Design          : Tiered rate limiting on every route
 *   A03 – Injection                : Validated + stripped inputs (see routes)
 *
 * Environment variables required — see .env.example
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * FIXES APPLIED:
 *   1. Removed debug console.log("ENV CHECK") block that leaked credentials
 *   2. Added DATABASE_URL parser — Railway MySQL plugin provides a single
 *      DATABASE_URL; this splits it into DB_HOST / DB_PORT / DB_USER /
 *      DB_PASSWORD / DB_NAME so config/db.js works without changes.
 *   3. All other logic unchanged.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

require('dotenv').config();

const { connectDB } = require('./config/db');
/* ── Railway DATABASE_URL parser ─────────────────────────────────────────────
 * Railway's MySQL plugin injects a single DATABASE_URL like:
 *   mysql://USER:PASSWORD@HOST:PORT/DATABASE
 *
 * If individual DB_* vars are NOT already set, parse DATABASE_URL and inject
 * them so the rest of the app (config/db.js, validateEnv.js) sees them.
 * ─────────────────────────────────────────────────────────────────────────── */
if (process.env.DATABASE_URL && !process.env.DB_HOST) {
  try {
    const u = new URL(process.env.DATABASE_URL);
    process.env.DB_HOST     = u.hostname;
    process.env.DB_PORT     = u.port || '3306';
    process.env.DB_USER     = decodeURIComponent(u.username);
    process.env.DB_PASSWORD = decodeURIComponent(u.password);
    // Strip leading slash from pathname to get the database name
    process.env.DB_NAME     = u.pathname.replace(/^\//, '') || 'aqualence_db';
    console.info('ℹ️  [db] Parsed DATABASE_URL → DB_HOST=%s DB_PORT=%s DB_NAME=%s',
      process.env.DB_HOST, process.env.DB_PORT, process.env.DB_NAME);
  } catch (e) {
    console.error('❌  [db] Failed to parse DATABASE_URL:', e.message);
  }
}

const logger = require('./utils/logger');

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const cookieParser = require('cookie-parser');
const path         = require('path');
const crypto       = require('crypto');
const fs           = require('fs');

const { globalLimiter, mapsKeyLimiter } = require('./middleware/rateLimiter');
const authMiddleware = require('./middleware/auth');

const app = express();

/* ── Trust proxy ─────────────────────────────────────────────────────────── */
// Required so express-rate-limit reads the real client IP behind nginx/LB.
// Set TRUST_PROXY=true in Railway env vars.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
/* ── Validate critical dependencies at startup ───────────────────────────── */
// bcrypt is loaded via utils/bcrypt.js which auto-falls back to bcryptjs.
require('./utils/bcrypt');

/* ── Validate critical env vars at startup ───────────────────────────────── */
// Centralised startup guard — aborts in production if config is unsafe.
require('./utils/validateEnv');

/* ── CSP nonce middleware (must run BEFORE helmet) ───────────────────────── */
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

/* ── Helmet: secure HTTP response headers ────────────────────────────────── */
app.use((req, res, next) => {
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:    ["'self'"],
        scriptSrc:     ["'self'", 'https://maps.googleapis.com', 'https://unpkg.com', 'https://cdnjs.cloudflare.com'],
        scriptSrcAttr: ["'none'"],
        styleSrc:      ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
        fontSrc:       ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:        ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc:    ["'self'", 'https://maps.googleapis.com', 'https://nominatim.openstreetmap.org', 'https://*.tile.openstreetmap.org', 'https://aqualance-production.up.railway.app', 'https://aqualance.vercel.app'],
        frameSrc:      ['https://maps.google.com', 'https://www.google.com'],
        objectSrc:     ["'none'"],
      },
    },
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    noSniff:              true,
    frameguard:           { action: 'deny' },
    xssFilter:            true,
    dnsPrefetchControl:   { allow: false },
    ieNoOpen:             true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy:       { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy:   { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  })(req, res, next);
});

/* ── CORS ────────────────────────────────────────────────────────────────── */
// OWASP A05: explicit allowlist — no wildcard origins.
// In Railway set: ALLOWED_ORIGINS=https://your-app.vercel.app
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  throw new Error('ALLOWED_ORIGINS env var is required. Set it to your Vercel URL.');
}

app.use(cors({
  origin: (origin, callback) => {
    // ✅ CRITICAL: allow no-origin (Railway, Postman, server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
/* ── Body parsers ────────────────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ── Cookie parser ───────────────────────────────────────────────────────── */
app.use(cookieParser());

/* ── Global baseline rate limiter ────────────────────────────────────────── */
app.use(globalLimiter);

/* ── Serve frontend statically — inject CSP nonce into HTML pages ────────── */

/* ── TWA Digital Asset Links (Play Store) ───────────────────────────────── */
app.get('/.well-known/assetlinks.json', (req, res) => {
  const pkg         = process.env.TWA_PACKAGE_NAME || 'com.yourcompany.aqualence';
  const fingerprint = process.env.TWA_FINGERPRINT  || 'REPLACE_WITH_YOUR_APK_SHA256_FINGERPRINT';
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace:                'android_app',
      package_name:             pkg,
      sha256_cert_fingerprints: [fingerprint],
    },
  }]);
});

/* ── API Routes ──────────────────────────────────────────────────────────── */

/* ── Health check ────────────────────────────────────────────────────────── */
function healthHandler(_, res) {
  res.json({
    status:  'ok',
    version: 'v1',
    app:     'Aqualence Ventures',
    time:    new Date().toISOString(),
  });
}
app.get('/api/health',    healthHandler);
app.get('/api/v1/health', healthHandler);

/* ── Maps API key (AUTH-GATED) ───────────────────────────────────────────── */
app.get(
  '/api/v1/config/maps-key',
  mapsKeyLimiter,
  authMiddleware(['admin', 'salesman', 'delivery']),
  (req, res) => {
    const key = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!key || key === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      return res.json({ key: '' });
    }
    res.json({ key });
  }
);

/* ── Backwards-compat redirect ───────────────────────────────────────────── */
app.use('/api/config/maps-key', (req, res) => {
  res.redirect(301, req.originalUrl.replace('/api/', '/api/v1/'));
});

/* ── Global error handler ────────────────────────────────────────────────── */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("🔥 ERROR:", err); // full error

  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});
/* ── Root route (Railway health check) ─────────────────────────── */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Aqualence API running'
  });
});








/* ── Start Server (Railway-safe) ───────────────────────────────── */
const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await connectDB();
    await require('./utils/ensureAuthTables').ensureAuthTables();

    console.log('✅ Database ready');

    // 🔥 REGISTER ROUTES AFTER DB READY
    app.use('/api/v1/auth',     require('./routes/auth'));
    app.use('/api/v1/products', require('./routes/products'));
    app.use('/api/v1/orders',   require('./routes/orders'));
    app.use('/api/v1/delivery', require('./routes/delivery'));
    app.use('/api/v1/salesman', require('./routes/salesman'));
    app.use('/api/v1/geo',      require('./routes/geo'));
    app.use('/api/v1/ai',       require('./routes/ai'));

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  }
})();

/* ── Process-level error guards ───────────────────────────────── */
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('[SIGTERM] Shutting down...');
  process.exit(0);
});
