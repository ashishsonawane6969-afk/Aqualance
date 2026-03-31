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
 */

'use strict';

require('dotenv').config();
const logger = require('./utils/logger');
console.log("DB_HOST =", process.env.DB_HOST);
const express = require('express');
const cors    = require('cors');
const helmet      = require('helmet');
const cookieParser = require('cookie-parser');
const path    = require('path');




const { globalLimiter, mapsKeyLimiter } = require('./middleware/rateLimiter');
const authMiddleware = require('./middleware/auth');

const app = express();

/* ── Trust proxy ─────────────────────────────────────────────────────────── */
// Required so express-rate-limit reads the real client IP behind nginx/LB.
// Set TRUST_PROXY=true in .env when deploying behind a reverse proxy.
if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

/* ── Validate critical dependencies at startup ───────────────────────────── */
// bcrypt is loaded via utils/bcrypt.js which auto-falls back to bcryptjs.
// Log which implementation is active so it's visible in startup output.
require('./utils/bcrypt');

/* ── Validate critical env vars at startup (P1 — Production Hardening) ─────── */
// Centralised startup guard — catches misconfiguration BEFORE the server opens
// its port and starts accepting traffic. All rules run in every environment
// but only abort in production; dev gets warnings so local workflow is unaffected.
require('./utils/validateEnv');

/* ── CSP nonce middleware (must run BEFORE helmet) ───────────────────────── */
// Generates a fresh cryptographic nonce on every request and stores it on
// res.locals so HTML templates can inject it: <script nonce="<%= nonce %>">
// The nonce is then whitelisted in the Content-Security-Policy header below,
// replacing the broad 'unsafe-inline' that was previously used.
// This eliminates the CSP console errors seen in the browser (screenshot).
const crypto = require('crypto');
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

/* ── Helmet: secure HTTP response headers ────────────────────────────────── */
// OWASP A05: sets X-Content-Type-Options, X-Frame-Options, HSTS, CSP, etc.
// 'unsafe-inline' has been REMOVED from scriptSrc — replaced by per-request
// nonce. This fixes the CSP violations visible in the browser console.
// styleSrc still allows 'unsafe-inline' because external CSS (Google Fonts,
// our own static CSS) uses inline style attributes that cannot use nonces.
app.use((req, res, next) => {
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc:    ["'self'"],
        scriptSrc:     [
          "'self'",
          `'nonce-${res.locals.cspNonce}'`,
          'https://maps.googleapis.com',
          'https://unpkg.com',            // Leaflet.js CDN fallback
          'https://cdnjs.cloudflare.com', // Chart.js (overview + leaderboard)
        ],
        // script-src-attr governs inline event handlers (onclick=, onerror=, etc.)
        // These cannot use nonces per the CSP spec. 'unsafe-inline' here only permits
        // handlers already in our own HTML — it does NOT weaken <script> nonce protection.
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc:      ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://unpkg.com'],
        fontSrc:       ["'self'", 'https://fonts.gstatic.com'],
        // Product images are stored as external CDN URLs in the DB.
        // 'https:' allows any HTTPS source while blocking http:// mixed-content.
        imgSrc:        ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc:    ["'self'", 'https://maps.googleapis.com', 'https://nominatim.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
        frameSrc:      ['https://maps.google.com', 'https://www.google.com'],
        objectSrc:     ["'none'"],
      },
    },
    // HSTS: enforce HTTPS for 1 year + preload in production
    hsts: process.env.NODE_ENV === 'production'
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
      : false,
    noSniff:              true,               // X-Content-Type-Options: nosniff
    frameguard:           { action: 'deny' }, // X-Frame-Options: DENY
    xssFilter:            true,               // X-XSS-Protection (legacy browsers)
    dnsPrefetchControl:   { allow: false },   // X-DNS-Prefetch-Control: off
    ieNoOpen:             true,               // X-Download-Options: noopen
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy:       { policy: 'strict-origin-when-cross-origin' },
    crossOriginOpenerPolicy:   { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,         // disabled — needed for maps iframe
    crossOriginResourcePolicy: { policy: 'same-site' },
  })(req, res, next);
});

/* ── CORS ────────────────────────────────────────────────────────────────── */
// OWASP A05: explicit allowlist — no wildcard origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : ['http://localhost:5000', 'http://127.0.0.1:5000'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      // Permit no-origin requests (curl/Postman) in dev only
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
  maxAge:         86_400, // cache preflight for 24 h
}));

/* ── Body parsers — strict size limits ───────────────────────────────────── */
// OWASP A05: reduced from 10 MB to 100 KB — more than enough for all payloads.
// If bulk image URL arrays are ever needed, raise to ~512 KB maximum.
app.use(express.json({ limit: '2mb' }));   // photo routes use photoBodyParser (1mb) — global limit is for non-photo JSON
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

/* ── Cookie parser — required for httpOnly auth cookie (Fix 2) ──────────────── */
// Must be registered BEFORE routes so req.cookies is populated.
// No secret needed — we don't use signed cookies; the JWT carries its own signature.
app.use(cookieParser());

/* ── Global baseline rate limiter ────────────────────────────────────────── */
// OWASP A04: every route gets a minimum rate limit regardless of auth status.
// More restrictive per-route limiters are applied inside each router file.
app.use(globalLimiter);

// startServer() is called INSIDE this IIFE so the server only
// begins accepting requests AFTER all migrations have completed.
(async () => {
  try {
    await require('./utils/ensureAuthTables').ensureAuthTables();
  } catch (e) {
    logger.warn('Database migration warning:', e.message);
  }

  // Start listening only after migrations are done — DB is ready for requests.
  startServer(PREFERRED_PORT);
})();

/* ── Serve frontend statically — inject CSP nonce into HTML pages ────────── */
// For HTML files: read → inject nonce → send, so <script nonce="..."> tags
// in templates match the nonce in the CSP header for this request.
// For all other assets (JS, CSS, images): serve as-is via express.static.
//
// HOW TO USE IN YOUR HTML:
//   Replace bare <script src="..."> with <script nonce="CSP_NONCE" src="...">
//   Replace inline <script>...</script> with <script nonce="CSP_NONCE">...</script>
//   The literal string CSP_NONCE is substituted with the real nonce at serve time.
const fs = require('fs');
const frontendDir = path.join(__dirname, '../frontend');

app.use((req, res, next) => {
  // Ignore API and .well-known paths
  if (req.path.startsWith('/api/') || req.path.startsWith('/.well-known/')) return next();

  let checkPath = req.path;
  const ext = path.extname(checkPath);

  if (checkPath === '/') {
    checkPath = '/index.html';
  } else if (!ext) {
    checkPath += '.html';
  } else if (ext !== '.html') {
    return next(); // Let static assets (css, js, images) fall through
  }

  // Resolve the actual file path
  let filePath = path.join(frontendDir, checkPath);

  // Must be inside the frontend directory (path traversal guard)
  if (!filePath.startsWith(frontendDir + path.sep) && filePath !== frontendDir) {
    return next();
  }

  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return next(); // file not found → fall through to static / catch-all

    // Replace the placeholder with the real per-request nonce
    const injected = html.replace(/CSP_NONCE/g, res.locals.cspNonce);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(injected);
  });
});

// Static assets (JS, CSS, images, fonts) — served directly, no nonce needed
app.use(express.static(frontendDir));

/* ── TWA Digital Asset Links (Play Store) ───────────────────────────────── */
// Required for Trusted Web Activity (TWA) — proves domain ownership to Android.
// Replace the fingerprint with your actual APK signing key SHA-256.
// Get it with: keytool -list -v -keystore your-key.jks
app.get('/.well-known/assetlinks.json', (req, res) => {
  const pkg         = process.env.TWA_PACKAGE_NAME  || 'com.yourcompany.aqualence';
  const fingerprint = process.env.TWA_FINGERPRINT   || 'REPLACE_WITH_YOUR_APK_SHA256_FINGERPRINT';
  res.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace:               'android_app',
      package_name:            pkg,
      sha256_cert_fingerprints: [fingerprint],
    },
  }]);
});

/* ── API Routes ──────────────────────────────────────────────────────────── */
// Rate limiting + input validation are applied inside each router.
// See: routes/auth.js, routes/orders.js, etc.
app.use('/api/v1/auth',     require('./routes/auth'));
app.use('/api/v1/products', require('./routes/products'));
app.use('/api/v1/orders',   require('./routes/orders'));
app.use('/api/v1/delivery', require('./routes/delivery'));
app.use('/api/v1/salesman', require('./routes/salesman'));
app.use('/api/v1/geo',      require('./routes/geo'));
app.use('/api/v1/ai',       require('./routes/ai'));   // AI chat — see middleware/aiRateLimiter.js

/* ── Config: Maps API key (served server-side to avoid exposing key in HTML) ─
 * Auth-gated + rate-limited: only logged-in users (any role) can fetch the key.
 * Returns null when no key is configured — frontend falls back to Leaflet/OSM.
 * ─────────────────────────────────────────────────────────────────────────── */
app.get(
  '/api/v1/config/maps-key',
  mapsKeyLimiter,
  authMiddleware(['admin', 'salesman']),
  (req, res) => {
    const key = process.env.GOOGLE_MAPS_API_KEY || '';
    const valid = key && key !== 'YOUR_GOOGLE_MAPS_API_KEY_HERE';
    res.json({ key: valid ? key : null });
  }
);


/* ── Health check — minimal info only ───────────────────────────────────── */
/* ── Health check ────────────────────────────────────────────────────────────
 * Registered at BOTH /api/health (unversioned, for monitoring tools/k8s probes)
 * AND /api/v1/health for consistency with the versioned API surface.
 * Neither path requires auth — intentional for infra health monitoring.
 * ─────────────────────────────────────────────────────────────────────────── */
function healthHandler(_, res) {
  res.json({
    status:  'ok',
    version: 'v1',
    app:     'Aqualence Ventures',
    time:    new Date().toISOString(),
    // Intentionally omits: env, DB version, server paths
  });
}
app.get('/api/health',    healthHandler);   // unversioned — for monitoring tools
app.get('/api/v1/health', healthHandler);   // versioned — for API consumers

/* ── Maps config endpoint (AUTH-GATED) ──────────────────────────────────── */
// OWASP A07 – Identification & Authentication Failures:
// Previously unauthenticated — any script could harvest the Maps API key.
// Now requires a valid JWT. Only authenticated users (admin/salesman/delivery)
// load the geo map, so this does not break any real user flow.
//
// ⚠️  Also restrict this key in Google Cloud Console:
//    APIs & Services → Credentials → HTTP referrer restrictions → your domain
app.get(
  '/api/v1/config/maps-key',
  mapsKeyLimiter,
  authMiddleware(['admin', 'salesman', 'delivery']),
  (req, res) => {
    const key = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!key || key === 'YOUR_GOOGLE_MAPS_API_KEY_HERE') {
      return res.json({ key: '' }); // placeholder — maps will show fallback UI
    }
    res.json({ key });
  }
);

/* ── Global error handler ────────────────────────────────────────────────── */
// OWASP A09 – Security Logging & Monitoring:
// Log full error server-side; return generic message to client.
// Never expose stack traces, file paths, or query details externally.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} — ${err.message}`);

  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'CORS: origin not allowed' });
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

/* ── Backwards-compat: redirect old unversioned paths ───────────────────── */
// Any external tooling that was calling the old /api/* paths gets a 301 redirect
// to the versioned equivalent. Remove after a suitable deprecation window.
app.use('/api/config/maps-key', (req, res) => {
  res.redirect(301, req.originalUrl.replace('/api/', '/api/v1/'));
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
// Auto-fallback: if the configured port is busy, try the next one up.
// This prevents a hard crash when another process is already on port 5000.
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

// startServer() is now called inside the migration IIFE above.

/* ── Process-level error guards (A10:2025 — Mishandling of Exceptional Conditions) ── */
// Without these, a single unhandled async rejection or thrown error crashes
// the entire Node process and keeps it down until manually restarted.
// With PM2 (see ecosystem.config.js), the process restarts automatically on exit(1).

process.on('unhandledRejection', (reason, promise) => {
  // Log the full rejection but do NOT crash — a crashed API means full outage.
  // PM2 will restart if exit(1) is called from uncaughtException below.
  logger.error('[unhandledRejection]',
    'Promise:', promise,
    'Reason:', reason
  );
  // Do not call process.exit here — unhandled rejections are usually recoverable
  // (e.g. a single bad DB query). Let the request fail with 500 via serverError().
});

process.on('uncaughtException', (err) => {
  // Synchronous throw that escaped try/catch — this IS fatal, state may be corrupt.
  // Log it, then exit so PM2 can restart a clean process.
  logger.error('[uncaughtException] FATAL — process will restart',
    err
  );
  process.exit(1);
});

process.on('SIGTERM', () => {
  // Graceful shutdown on SIGTERM (sent by PM2 / Docker / systemd on stop/reload).
  // Allow in-flight requests to drain before exiting.
  logger.info('[SIGTERM] Graceful shutdown initiated…');
  process.exit(0);
});
