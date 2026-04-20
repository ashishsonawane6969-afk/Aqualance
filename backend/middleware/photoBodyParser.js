'use strict';

const express = require('express');

/**
 * Route-level body parser permitting up to 30 MB JSON bodies.
 * Used on lead routes that accept both a photo_proof (base64) AND a products array.
 *
 * Limit: 30 MB
 *   - photo_data base64: up to ~27 MB (supports up to 20 MB binary images)
 *   - products array (up to 50 items × ~200 bytes each): ~10 KB
 *   - Other text fields: ~2 KB
 */
const photoBodyParser = express.json({ limit: '30mb' });

module.exports = { photoBodyParser };
