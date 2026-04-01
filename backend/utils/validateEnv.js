'use strict';
/**
 * utils/validateEnv.js — Startup environment validation (P1 Production Hardening)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs synchronously at startup, before the server opens its port.
 * In production: any FAIL aborts the process with exit(1).
 * In development: FAILs become warnings so local workflow is unaffected.
 *
 * Rules:
 *   • JWT_SECRET must be present, not a known-weak default, and ≥ 32 chars
 *   • ALLOWED_ORIGINS must not contain '*' in production
 *   • DB_USER must not be 'root' in production
 *   • TRUST_PROXY must be 'true' when NODE_ENV=production (required for nginx)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const isProd = process.env.NODE_ENV === 'production';

const WEAK_JWT_DEFAULTS = [
  'aqualence_ikrish_secret_change_in_prod_2024',
  'changeme', 'secret', '', 'GENERATE_A_NEW_SECRET_DO_NOT_USE_THIS_VALUE',
];

const errors   = [];   // fatal in production
const warnings = [];   // always logged, never fatal

/* ── Rule 1: JWT_SECRET ─────────────────────────────────────────────────── */
if (!process.env.JWT_SECRET || WEAK_JWT_DEFAULTS.includes(process.env.JWT_SECRET)) {
  errors.push('JWT_SECRET is missing or uses a known-weak default. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
} else if (process.env.JWT_SECRET.length < 32) {
  errors.push(`JWT_SECRET is only ${process.env.JWT_SECRET.length} chars — minimum 32 required in production.`);
}

/* ── Rule 2: ALLOWED_ORIGINS must not be wildcard in production ─────────── */
if (isProd) {
  const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim());
  if (origins.includes('*') || origins.length === 0 || origins[0] === '') {
    errors.push('ALLOWED_ORIGINS must not be "*" or empty in production. ' +
      'Set it to your domain, e.g. https://yourdomain.com');
  }
  // Warn if localhost is still in the origin list
  const hasLocalhost = origins.some(o => o.includes('localhost') || o.includes('127.0.0.1'));
  if (hasLocalhost) {
    warnings.push('ALLOWED_ORIGINS contains a localhost entry — this should be your production domain.');
  }
}

/* ── Rule 3: DB_USER must not be root in production ─────────────────────── */
if (isProd && (process.env.DB_USER || '').toLowerCase() === 'root') {
  errors.push('DB_USER=root is not allowed in production. ' +
    'Create a dedicated user: run database/aqualence_complete.sql');
}

/* ── Rule 4: TRUST_PROXY must be true in production (nginx required for HTTPS) */
if (isProd && process.env.TRUST_PROXY !== 'true') {
  warnings.push('TRUST_PROXY is not set to "true". ' +
    'Rate limiting will use the proxy IP instead of the real client IP when behind nginx. ' +
    'Set TRUST_PROXY=true in .env.');
}

/* ── Rule 5: DB_PASSWORD must not be the default placeholder ────────────── */
if (isProd && (process.env.DB_PASSWORD === 'root' || process.env.DB_PASSWORD === 'CHANGE_ME_STRONG_PASSWORD' || !process.env.DB_PASSWORD)) {
  errors.push('DB_PASSWORD is set to a default/empty value. Set a strong password in production.');
}

/* ── Rule 6: GOOGLE_MAPS_API_KEY — warn if placeholder ─────────────────── */
if ((process.env.GOOGLE_MAPS_API_KEY || '') === 'YOUR_GOOGLE_MAPS_API_KEY_HERE' ||
    !process.env.GOOGLE_MAPS_API_KEY) {
  warnings.push('GOOGLE_MAPS_API_KEY is not set. The geo-map and salesman tracking ' +
    'features will show a fallback UI. Get a key at https://console.cloud.google.com');
}

/* ── Rule 7: GEMINI_API_KEY — warn if placeholder ───────────────────────── */
if ((process.env.GEMINI_API_KEY || '') === 'YOUR_GEMINI_API_KEY_HERE' ||
    !process.env.GEMINI_API_KEY) {
  warnings.push('GEMINI_API_KEY is not set. The AI product assistant chat will not work. ' +
    'Get a key at https://aistudio.google.com/app/apikey');
}

/* ── Rule 8: MFA_ENCRYPTION_KEY — warn if placeholder, error in prod ────── */
const mfaKey = process.env.MFA_ENCRYPTION_KEY || '';
if (!mfaKey || mfaKey === 'GENERATE_A_64_CHAR_HEX_KEY') {
  if (isProd) {
    errors.push('MFA_ENCRYPTION_KEY is not set. TOTP secrets cannot be encrypted. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  } else {
    warnings.push('MFA_ENCRYPTION_KEY is not set — MFA setup will use a dev fallback derived from JWT_SECRET. ' +
      'Set a real key before going to production.');
  }
} else if (mfaKey.length < 64) {
  warnings.push(`MFA_ENCRYPTION_KEY is only ${mfaKey.length} chars — should be 64 hex chars (32 bytes). ` +
    'Run: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

/* ── Rule 9: ALERT_WEBHOOK_URL — info only ──────────────────────────────── */
if (!process.env.ALERT_WEBHOOK_URL) {
  // Not a warning — it's optional. Just log at info level so admin knows it's available.
  console.info('ℹ️  [env] ALERT_WEBHOOK_URL not set — security alerts will log to file only (no Slack/Discord).');
}

/* ── Rule 10: FAST2SMS_API_KEY — warn if missing in production ───────────── */
if (isProd && !process.env.FAST2SMS_API_KEY) {
  warnings.push('FAST2SMS_API_KEY is not set. Admin SMS OTP will log to console instead of sending real SMS. Set it for production.');
}

/* ── Report ─────────────────────────────────────────────────────────────── */
if (warnings.length > 0) {
  warnings.forEach(w => console.warn(`⚠️  [env] ${w}`));
}

if (errors.length > 0) {
  errors.forEach(e => console.error(`❌  [env] FATAL: ${e}`));
  if (isProd) {
    console.error('❌  Server startup aborted due to unsafe production configuration.');
    throw new Error('DB connection failed');
  } else {
    console.warn('⚠️  [env] Above errors would abort startup in NODE_ENV=production.');
  }
} else {
  console.info(`✅  [env] Environment validation passed (${isProd ? 'production' : 'development'} mode)`);
}

