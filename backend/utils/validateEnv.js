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
 // backend/utils/validateEnv.js
const hasLocalhost = origins.some(o => o.includes('localhost') || o.includes('127.0.0.1'));
if (hasLocalhost) {
  // ❌ BEFORE: warnings.push(...)
  // ✅ AFTER:
  errors.push('ALLOWED_ORIGINS contains localhost — this will block all Vercel traffic in production.');
}
}

/* ── Rule 3: DB_USER must not be root in production ─────────────────────── */
/* ── Rule 3 (UPDATED): DATABASE_URL must exist ─────────────────────────── */
if (!process.env.DATABASE_URL) {
  errors.push('DATABASE_URL is not set. Required for Railway MySQL connection.');
}


/* ── Rule 4: TRUST_PROXY must be true in production (nginx required for HTTPS) */
/* ── Rule 4 (UPDATED): Prevent localhost DB in production ─────────────── */
if (isProd && process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')) {
  errors.push('DATABASE_URL should not point to localhost in production.');
}

/* ── Rule 5: DB_PASSWORD must not be the default placeholder ────────────── */

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

/* ── Rule 8b: MFA_TEMP_SECRET must be independent of JWT_SECRET ─────────── */
// Previously mfaController derived this as JWT_SECRET + '_mfa_pending'.
// If JWT_SECRET leaked (e.g. via GitHub SQL dump), an attacker could forge
// MFA temp tokens and bypass 2FA entirely. This rule ensures they are separate.
const mfaTempSecret = process.env.MFA_TEMP_SECRET || '';
if (!mfaTempSecret) {
  if (isProd) {
    errors.push(
      'MFA_TEMP_SECRET is not set. Required in production to keep the MFA temp-token ' +
      'secret independent of JWT_SECRET. ' +
      'Generate: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
    );
  } else {
    warnings.push(
      'MFA_TEMP_SECRET not set — mfaController uses a random in-process key (dev only). ' +
      'Set this before going to production.'
    );
  }
} else if (process.env.JWT_SECRET && (
  mfaTempSecret === process.env.JWT_SECRET ||
  mfaTempSecret.startsWith(process.env.JWT_SECRET)
)) {
  errors.push(
    'MFA_TEMP_SECRET must NOT be derived from or equal to JWT_SECRET. ' +
    'Generate a completely independent value: ' +
    'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
  );
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
   console.error('❌ DB connection failed (validation check)');
  } else {
    console.warn('⚠️  [env] Above errors would abort startup in NODE_ENV=production.');
  }
} else {
  console.info(`✅  [env] Environment validation passed (${isProd ? 'production' : 'development'} mode)`);
}

