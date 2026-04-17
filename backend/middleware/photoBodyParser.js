'use strict';

const express = require('express');

/**
 * Route-level body parser permitting up to 1 MB JSON bodies.
 * Used on lead routes that accept both a photo_proof (base64) AND a products array.
 *
 * Limit: 1 MB
 *   - photo_proof base64: up to ~200 KB (as enforced by Joi schema)
 *   - products array (up to 50 items × ~200 bytes each): ~10 KB
 *   - Other text fields: ~2 KB
 *   - Headroom: 1 MB provides a comfortable safety margin
 */
const photoBodyParser = express.json({ limit: '1mb' });

module.exports = { photoBodyParser };
