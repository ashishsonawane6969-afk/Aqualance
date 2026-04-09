'use strict';
/**
 * services/sms.js — Fast2SMS OTP service
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW TO GET YOUR API KEY:
 *   1. Register at https://www.fast2sms.com
 *   2. Go to Dev API → API Key → Copy
 *   3. Add to .env:  FAST2SMS_API_KEY=your_key_here
 *
 * In dev (no key set): OTP is printed to server console only.
 */

const crypto = require('crypto');
const https  = require('https');

// Cryptographically secure 6-digit OTP
function generateOtp() {
  return String(crypto.randomInt(100000, 999999));
}

/**
 * Send OTP via Fast2SMS
 * @param {string} phone - 10-digit Indian mobile number
 * @param {string} otp   - 6-digit OTP
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function sendOtp(phone, otp) {
  const apiKey = process.env.FAST2SMS_API_KEY;

  // Dev mode — no key set
  if (!apiKey || apiKey === 'YOUR_FAST2SMS_API_KEY_HERE') {
    console.warn(`[sms] DEV MODE — OTP for ${phone.slice(0, 4)}XXXXXX: ${otp}`);
    return { success: true, message: 'OTP logged (dev mode)' };
  }

  return new Promise((resolve) => {
    const params = new URLSearchParams({
      authorization:    apiKey,
      variables_values: otp,
      route:            'otp',
      numbers:          phone,
    });

    const req = https.request({
      hostname: 'www.fast2sms.com',
      path:     `/dev/bulkV2?${params.toString()}`,
      method:   'GET',
      headers:  { 'cache-control': 'no-cache' },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.return === true) {
            console.info(`[sms] OTP sent — ${phone.slice(0, 4)}XXXXXX`);
            resolve({ success: true, message: 'OTP sent' });
          } else {
            console.error('[sms] Fast2SMS error:', json.message);
            resolve({ success: false, message: json.message || 'SMS delivery failed' });
          }
        } catch {
          console.error('[sms] Parse error:', data.slice(0, 100));
          resolve({ success: false, message: 'SMS service error' });
        }
      });
    });

    req.on('error', (e) => {
      console.error('[sms] Network error:', e.message);
      resolve({ success: false, message: 'SMS service unavailable' });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ success: false, message: 'SMS timeout' });
    });

    req.end();
  });
}

function isSmsConfigured() {
  const k = process.env.FAST2SMS_API_KEY;
  return !!(k && k !== 'YOUR_FAST2SMS_API_KEY_HERE');
}

module.exports = { generateOtp, sendOtp, isSmsConfigured };
