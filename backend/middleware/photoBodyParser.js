'use strict';

const express = require('express');

/**
 * Route-level body parser for routes that accept a photo_proof / photo_data field.
 *
 * SECURITY FIX: Limit reduced from 30MB to 5MB.
 *   Old limit (30MB) allowed authenticated salesmen to send 200 × 30MB = 6GB
 *   of JSON per 5-minute rate-limit window, causing memory exhaustion.
 *
 * Size breakdown at 5MB:
 *   - photo_data base64: up to ~3.75MB binary image (~3MB is plenty for a shop photo)
 *   - products array (up to 50 items × ~200 bytes each): ~10KB
 *   - Other text fields: ~2KB
 *
 * If a legitimate use case requires larger images, compress client-side before
 * base64-encoding (canvas.toBlob with quality=0.7 keeps most photos under 500KB).
 */
const photoBodyParser = express.json({ limit: '5mb' });

module.exports = { photoBodyParser };
