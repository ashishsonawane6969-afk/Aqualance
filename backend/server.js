'use strict';

require('dotenv').config();

const { connectDB } = require('./config/db');

/* ── Railway DATABASE_URL parser ─────────────────────────────────────────── */
if (process.env.DATABASE_URL && !process.env.DB_HOST) {
  try {
    const u = new URL(process.env.DATABASE_URL);
    process.env.DB_HOST     = u.hostname;
    process.env.DB_PORT     = u.port || '3306';
    process.env.DB_USER     = decodeURIComponent(u.username);
    process.env.DB_PASSWORD = decodeURIComponent(u.password);
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

const { globalLimiter, mapsKeyLimiter } = require('./middleware/rateLimiter');
const authMiddleware = require('./middleware/auth');

const app = express();

/* ── Trust proxy ─────────────────────────────────────────────────────────── */
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

require('./utils/bcrypt');
require('./utils/validateEnv');

/* ── CSP nonce middleware ───────────────────────────────────────────────── */
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
  next();
});

/* ── Helmet ─────────────────────────────────────────────────────────────── */
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
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })(req, res, next);
});

/* ── CORS (FIXED) ────────────────────────────────────────────────────────── */
let allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Remove localhost in production
if (process.env.NODE_ENV === 'production') {
  const before = [...allowedOrigins];
  allowedOrigins = allowedOrigins.filter(o => !o.includes('localhost'));

  if (before.length !== allowedOrigins.length) {
    console.warn('⚠️ [CORS] localhost removed in production');
  }
}

// Ensure Vercel frontend always allowed
if (!allowedOrigins.includes('https://aqualance.vercel.app')) {
  allowedOrigins.push('https://aqualance.vercel.app');
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // allow Vercel preview deployments
    try {
      const hostname = new URL(origin).hostname;
      if (hostname.endsWith('.vercel.app')) {
        return callback(null, true);
      }
    } catch {}

    console.warn(`[CORS BLOCKED] ${origin}`);
    return callback(null, false); // IMPORTANT: no error throw
  },
  credentials: true,
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization']
}));

app.options('*', cors({
  origin: allowedOrigins,
  credentials: true
}));

/* ── Body parsers ────────────────────────────────────────────────────────── */
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(cookieParser());
app.use(globalLimiter);

/* ── Static frontend ─────────────────────────────────────────────────────── */
const frontendPath = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));

/* ── Health ─────────────────────────────────────────────────────────────── */
app.get('/api/health', (_, res) => res.json({ status: 'ok' }));
app.get('/api/v1/health', (_, res) => res.json({ status: 'ok' }));

/* ── Maps key ───────────────────────────────────────────────────────────── */
app.get(
  '/api/v1/config/maps-key',
  mapsKeyLimiter,
  authMiddleware(['admin', 'salesman', 'delivery']),
  (req, res) => {
    res.json({ key: process.env.GOOGLE_MAPS_API_KEY || '' });
  }
);

/* ── Error handler ──────────────────────────────────────────────────────── */
app.use((err, req, res, next) => {
  console.error("🔥 ERROR:", err);

  res.status(500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

/* ── Start Server ───────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 5000;
let httpServer = null;

(async () => {
  try {
    await connectDB();
    await require('./utils/ensureAuthTables').ensureAuthTables();

    console.log('✅ Database ready');

    app.use('/api/v1/auth',     require('./routes/auth'));
    app.use('/api/v1/products', require('./routes/products'));
    app.use('/api/v1/orders',   require('./routes/orders'));
    app.use('/api/v1/delivery', require('./routes/delivery'));
    app.use('/api/v1/salesman', require('./routes/salesman'));
    app.use('/api/v1/geo',      require('./routes/geo'));
    app.use('/api/v1/ai',       require('./routes/ai'));

    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API route not found' });
      }
      res.sendFile(path.join(frontendPath, 'index.html'));
    });

    httpServer = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

  } catch (err) {
    console.error('❌ Startup failed:', err);
    process.exit(1);
  }
})();
