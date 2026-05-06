/**
 * utils/ssrfGuard.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-Side Request Forgery (SSRF) prevention utility (A10:2021).
 *
 * Allows outbound requests ONLY to an explicit allowlist of hosts.
 * All other destinations are blocked — including private IPs (RFC 1918),
 * localhost variants, and cloud metadata endpoints (169.254.169.254).
 *
 * Usage:
 *   const { validateOutboundUrl } = require('./utils/ssrfGuard');
 *   const result = validateOutboundUrl(userUrl, 'GitHub export');
 *   if (!result.valid) return res.status(400).json({ error: result.reason });
 *
 * Returns: { valid: boolean, reason?: string, url?: URL }
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const ALLOWED_HOSTS = [
  'api.github.com',
  'www.fast2sms.com',
  'generativelanguage.googleapis.com',
  '*.googleapis.com',       // Gemini / other Google services
];

// Private/reserved IP ranges that must NEVER be reached from the server
const PRIVATE_IP_PATTERNS = [
  /^10\./,                          // RFC 1918 (10.0.0.0/8)
  /^172\.(1[6-9]|2\d|3[01])\./,  // RFC 1918 (172.16.0.0/12)
  /^192\.168\./,                    // RFC 1918 (192.168.0.0/16)
  /^127\./,                         // Loopback
  /^0\./,                           // Invalid
  /^169\.254\./,                    // Link-local / cloud metadata
  /^::1$/,                          // IPv6 loopback
  /^fc|^fd/,                        // IPv6 unique local
];

function isPrivateIp(hostname) {
  // Resolve hostname to IP if needed — for simplicity, block common patterns
  return PRIVATE_IP_PATTERNS.some(re => re.test(hostname));
}

function hostMatchesAllowed(hostname) {
  return ALLOWED_HOSTS.some(allowed => {
    if (allowed === hostname) return true;
    // Wildcard: *.googleapis.com matches generativelanguage.googleapis.com
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(2);
      return hostname === suffix || hostname.endsWith('.' + suffix);
    }
    return false;
  });
}

/**
 * Validate an outbound URL against the SSRF allowlist.
 *
 * @param {string} urlStr  - The URL the server intends to call
 * @param {string} context - Label for logs/error messages (e.g. 'GitHub export')
 * @returns {{ valid: boolean, reason?: string, url?: URL }}
 */
function validateOutboundUrl(urlStr, context = 'outbound request') {
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: `${context}: invalid URL format` };
  }

  // Only allow HTTPS (and HTTP for localhost dev if needed)
  if (parsed.protocol !== 'https:' && !(parsed.hostname === 'localhost' && process.env.NODE_ENV !== 'production')) {
    return { valid: false, reason: `${context}: only HTTPS is allowed (got ${parsed.protocol})` };
  }

  // Block private IPs
  if (isPrivateIp(parsed.hostname)) {
    return { valid: false, reason: `${context}: private IP addresses are not allowed (${parsed.hostname})` };
  }

  // Check allowlist
  if (!hostMatchesAllowed(parsed.hostname)) {
    return { valid: false, reason: `${context}: destination not in allowlist (${parsed.hostname})` };
  }

  return { valid: true, url: parsed };
}

module.exports = { validateOutboundUrl, ALLOWED_HOSTS };
