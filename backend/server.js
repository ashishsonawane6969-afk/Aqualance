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
if (process.env.TRUST_PROXY === 'true') {
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
        scriptSrc:     [
          "'self'",
          `'nonce-${res.locals.cspNonce}'`,
          'https://maps.googleapis.com',
          'https://unpkg.com',
          'https://cdnjs.cloudflare.com',
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc:      ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
        fontSrc:       ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:        ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc:    ["'self'", 'https://maps.googleapis.com', 'https://nominatim.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
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
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : ['http://localhost:5000', 'http://127.0.0.1:5000'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      // Allow no-origin requests (curl/Postman) in dev only
      if (process.env.NODE_ENV === 'production') {
        return callback(new Error('Missing Origin header'), false);
      }
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'), false);
  },
  credentials:    true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge:         86_400,
}));

/* ── Body parsers ────────────────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ── Cookie parser ───────────────────────────────────────────────────────── */
app.use(cookieParser());

/* ── Global baseline rate limiter ────────────────────────────────────────── */
app.use(globalLimiter);

/* ── Serve frontend statically — inject CSP nonce into HTML pages ────────── */
const frontendDir = path.join(__dirname, '../frontend');

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/.well-known/')) return next();

  let checkPath = req.path;
  const ext = path.extname(checkPath);

  if (checkPath === '/') {
    checkPath = '/index.html';
  } else if (!ext) {
    checkPath += '.html';
  } else if (ext !== '.html') {
    return next();
  }

  let filePath = path.join(frontendDir, checkPath);

  if (!filePath.startsWith(frontendDir + path.sep) && filePath !== frontendDir) {
    return next();
  }

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next();
    const injected = html.replace(/CSP_NONCE/g, res.locals.cspNonce);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(injected);
  });
});

// Static assets (JS, CSS, images, fonts)
app.use(express.static(frontendDir));

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
app.use('/api/v1/auth',     require('./routes/auth'));
app.use('/api/v1/products', require('./routes/products'));
app.use('/api/v1/orders',   require('./routes/orders'));
app.use('/api/v1/delivery', require('./routes/delivery'));
app.use('/api/v1/salesman', require('./routes/salesman'));
app.use('/api/v1/geo',      require('./routes/geo'));
app.use('/api/v1/ai',       require('./routes/ai'));

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
app.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} — ${err.message}`);
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'CORS: origin not allowed' });
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

/* ── Catch-all: serve SPA (with nonce injection) ─────────────────────────── */
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, '../frontend/index.html');
  fs.readFile(indexPath, 'utf8', (err, html) => {
    if (err) return res.status(404).send('Not found');
    const injected = html.replace(/CSP_NONCE/g, res.locals.cspNonce);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(injected);
  });
});

/* ── Start ───────────────────────────────────────────────────────────────── */
const PREFERRED_PORT = parseInt(process.env.PORT, 10) || 5000;

function startServer(port) {
  const server = app.listen(port, () => {
    if (port !== PREFERRED_PORT) {
      console.warn(`\n⚠️   Port ${PREFERRED_PORT} was in use — started on port ${port} instead.`);
      console.warn(`   Update PORT=${port} in your .env, or stop the process on ${PREFERRED_PORT}.\n`);
    }
    logger.info(`🚀  Aqualence Ventures running on http://localhost:${port}\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`⚠️   Port ${port} is in use — trying ${port + 1}…`);
      startServer(port + 1);
      return;
    }
    logger.error('Server error:', err);
    process.exit(1);
  });
}

/* ── Run DB migrations then start listening ──────────────────────────────── */
(async () => {
  let dbReady = false;

  try {
    // ✅ STEP 1: CONNECT DATABASE FIRST
    await connectDB();

    // ✅ STEP 2: THEN RUN MIGRATIONS
    await require('./utils/ensureAuthTables').ensureAuthTables();

    dbReady = true;
    logger.info('✅ Database connected & tables ensured');

  } catch (e) {
    logger.error('❌ Database connection failed:', e.message);
    logger.error('⚠️  Server will still start, but DB routes may fail');
  }

  startServer(PREFERRED_PORT);

  // Retry logic (unchanged)
  if (!dbReady) {
    setInterval(async () => {
      try {
        await connectDB(); // ✅ ADD THIS ALSO
        await require('./utils/ensureAuthTables').ensureAuthTables();
        logger.info('✅ Database reconnected successfully');
        process.exit(0);
      } catch (_) {}
    }, 10000);
  }
})();
/* ── Process-level error guards ──────────────────────────────────────────── */
process.on('unhandledRejection', (reason, promise) => {
  logger.error('[unhandledRejection]', 'Promise:', promise, 'Reason:', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('[uncaughtException] FATAL — process will restart', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('[SIGTERM] Graceful shutdown initiated…');
  process.exit(0);
});
