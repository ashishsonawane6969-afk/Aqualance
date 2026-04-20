/**
 * utils/validatePhoto.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side photo validation utility.
 *
 * Defence-in-depth after Joi schema validation:
 *   1. The Joi schema (schemas.js) checks the data URI *format* — it enforces
 *      the regex `^data:image/(jpeg|jpg|png|webp|gif);base64,...` so only
 *      allowlisted MIME types can pass.
 *
 *   2. This utility validates the *content* — it decodes the first few bytes
 *      of the base64 payload and checks the file magic bytes (signatures)
 *      against what the declared MIME type claims.
 *
 *      This catches "MIME confusion" attacks: an attacker who sends
 *      `data:image/jpeg;base64,<javascript_base64>` would pass the regex
 *      but fail here because the magic bytes won't match JPEG (FFD8FF).
 *
 * Magic byte signatures (hex):
 *   JPEG:  FF D8 FF
 *   PNG:   89 50 4E 47 0D 0A 1A 0A
 *   WebP:  52 49 46 46 ... 57 45 42 50  (RIFF....WEBP)
 *   GIF:   47 49 46 38  (GIF8)
 *
 * Returns: { valid: true } or { valid: false, reason: string }
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

// Maximum allowed base64 length (characters). 27,000,000 chars ≈ 20 MB binary.
const MAX_BASE64_CHARS = 27_000_000;

// Magic byte signatures for each allowed image type
const SIGNATURES = {
  'jpeg': [[0xFF, 0xD8, 0xFF]],
  'jpg':  [[0xFF, 0xD8, 0xFF]],
  'png':  [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
  // WebP: "RIFF" at 0-3, "WEBP" at 8-11
  'webp': [[0x52, 0x49, 0x46, 0x46]],
  // GIF87a or GIF89a
  'gif':  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
           [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]],
};

/**
 * Validate a base64 photo data URI.
 *
 * @param {string|null|undefined} dataUri  — the full data:image/...;base64,... string
 * @param {string}                fieldName — for error messages (e.g. 'photo_proof')
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePhoto(dataUri, fieldName = 'photo') {
  // Null / empty is allowed — photos are optional
  if (!dataUri || dataUri === '') return { valid: true };

  // ── Step 1: Parse the data URI ─────────────────────────────────────────────
  // Format: data:<mime>;base64,<data>
  const PREFIX_RE = /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i;
  const match = dataUri.match(PREFIX_RE);

  if (!match) {
    return {
      valid:  false,
      reason: `${fieldName}: invalid data URI format or disallowed MIME type`,
    };
  }

  const declaredMime = match[1].toLowerCase();
  const base64Data   = dataUri.slice(match[0].length);

  // ── Step 2: Size check ─────────────────────────────────────────────────────
  if (base64Data.length > MAX_BASE64_CHARS) {
    return {
      valid:  false,
      reason: `${fieldName}: image too large (max ${Math.round(MAX_BASE64_CHARS * 0.75 / 1024)} KB)`,
    };
  }

  // ── Step 3: Magic byte verification ───────────────────────────────────────
  // Decode only the first 12 bytes (enough for any signature check).
  // Slice a safe amount of base64 chars: 12 bytes needs ceil(12/3)*4 = 16 chars.
  let headerBuf;
  try {
    headerBuf = Buffer.from(base64Data.slice(0, 16), 'base64');
  } catch {
    return { valid: false, reason: `${fieldName}: base64 decode failed` };
  }

  const expectedSigs = SIGNATURES[declaredMime];
  if (!expectedSigs) {
    return { valid: false, reason: `${fieldName}: unsupported image type` };
  }

  const matchesMagic = expectedSigs.some(sig =>
    sig.every((byte, i) => headerBuf[i] === byte)
  );

  if (!matchesMagic) {
    // Log the actual first bytes for debugging (no PII, just hex)
    const actual = Array.from(headerBuf.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    console.warn(
      `[validatePhoto] Magic byte mismatch — declared: ${declaredMime} — ` +
      `actual header: ${actual}`
    );
    return {
      valid:  false,
      reason: `${fieldName}: file content does not match declared image type`,
    };
  }

  // ── WebP extra check: bytes 8-11 must be "WEBP" ──────────────────────────
  if (declaredMime === 'webp') {
    const webpSig = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
    // Need 12 bytes for this check
    let fullHeaderBuf;
    try {
      fullHeaderBuf = Buffer.from(base64Data.slice(0, 20), 'base64');
    } catch {
      return { valid: false, reason: `${fieldName}: base64 decode failed` };
    }
    const isWebP = webpSig.every((byte, i) => fullHeaderBuf[8 + i] === byte);
    if (!isWebP) {
      return {
        valid:  false,
        reason: `${fieldName}: file content does not match declared image type`,
      };
    }
  }

  return { valid: true };
}

module.exports = { validatePhoto };
