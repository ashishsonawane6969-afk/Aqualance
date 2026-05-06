'use strict';
/**
 * utils/securityAlerts.js — Security event alert hook (A09:2025 fix)
 * ─────────────────────────────────────────────────────────────────────────────
 * Fires on high-value security events and logs them with structured context.
 * In production, plug in a real alerting backend (email, Slack, PagerDuty)
 * by setting ALERT_WEBHOOK_URL in .env — the function POSTs a JSON payload.
 *
 * Events covered:
 *   ACCOUNT_LOCKED        — brute-force lockout triggered
 *   MULTIPLE_FAILED_LOGIN — N consecutive failures before lockout
 *   MFA_VERIFY_FAIL       — wrong OTP on admin login
 *   INACTIVE_LOGIN_ATTEMPT— disabled account tried to log in
 *   RATE_LIMIT_HIT        — IP exceeded a rate limiter threshold
 *   ADMIN_LOGIN           — successful admin login (audit trail)
 *   MFA_DISABLED          — admin turned off MFA
 * ─────────────────────────────────────────────────────────────────────────────
 */

const logger = require('./logger');

/* ── Severity levels ────────────────────────────────────────────────────────*/
const SEVERITY = {
  INFO:     'INFO',
  WARNING:  'WARNING',
  CRITICAL: 'CRITICAL',
};

/* ── Core alert function ────────────────────────────────────────────────────*/
async function alert(event, severity, details = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    event,
    severity,
    app:       'aqualence',
    ...details,
  };

  // Always write to the structured log (Winston → /var/log/aqualence/error.log in prod)
  if (severity === SEVERITY.CRITICAL) {
    logger.error(`[SECURITY_ALERT] ${event}`, payload);
  } else if (severity === SEVERITY.WARNING) {
    logger.warn(`[SECURITY_ALERT] ${event}`, payload);
  } else {
    logger.info(`[SECURITY_AUDIT] ${event}`, payload);
  }

  // ── Webhook: POST to ALERT_WEBHOOK_URL if configured ──────────────────────
  // Supports Slack incoming webhooks, Discord, or any HTTP endpoint.
  // Format compatible with Slack's Block Kit simple message:
  //   ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx/yyy/zzz
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    // SSRF mitigation: validate webhook URL is in the allowlist
    const { validateOutboundUrl } = require('./ssrfGuard');
    const ssrfCheck = validateOutboundUrl(webhookUrl, 'security webhook');
    if (!ssrfCheck.valid) {
      logger.warn('[securityAlerts] Webhook blocked by SSRF guard:', { reason: ssrfCheck.reason });
    } else {
      const emoji   = severity === SEVERITY.CRITICAL ? '🚨' : severity === SEVERITY.WARNING ? '⚠️' : 'ℹ️';
      const message = `${emoji} *[${severity}] ${event}*\n` +
        Object.entries(details)
          .filter(([k]) => !['password', 'token', 'secret'].includes(k)) // never leak secrets
          .map(([k, v]) => `  • ${k}: ${v}`)
          .join('\n');

      // Fire-and-forget — never block the HTTP response waiting for the webhook
      fetch(webhookUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: message }),
        signal:  AbortSignal.timeout(5000), // 5 s timeout
      }).catch(err => logger.warn('[securityAlerts] Webhook delivery failed:', { error: err.message }));
    }
  }
}

/* ── Named alert helpers (called from controllers) ─────────────────────────*/

exports.accountLocked = (userId, ip, failedAttempts) =>
  alert('ACCOUNT_LOCKED', SEVERITY.CRITICAL, { userId, ip, failedAttempts });

exports.multipleFailedLogins = (phone, ip, count) =>
  alert('MULTIPLE_FAILED_LOGIN', SEVERITY.WARNING, { phone, ip, count });

exports.mfaVerifyFailed = (userId, ip) =>
  alert('MFA_VERIFY_FAIL', SEVERITY.WARNING, { userId, ip });

exports.inactiveLoginAttempt = (userId, ip) =>
  alert('INACTIVE_LOGIN_ATTEMPT', SEVERITY.WARNING, { userId, ip });

exports.adminLogin = (userId, ip) =>
  alert('ADMIN_LOGIN', SEVERITY.INFO, { userId, ip });

exports.mfaDisabled = (userId, ip) =>
  alert('MFA_DISABLED', SEVERITY.WARNING, { userId, ip });

exports.rateLimitHit = (ip, route) =>
  alert('RATE_LIMIT_HIT', SEVERITY.WARNING, { ip, route });

exports.accessDenied = (userId, userRole, requiredRoles, ip, path) =>
  alert('ACCESS_DENIED', SEVERITY.WARNING, { userId, userRole, requiredRoles: requiredRoles.join(','), ip, path });
