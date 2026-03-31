/**
 * routes/products.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security applied:
 *  GET  /        — authenticatedLimiter + query param validation
 *  GET  /:id     — authenticatedLimiter only (read-only, ID parsed in controller)
 *  POST /        — authenticatedLimiter + admin auth + full product schema
 *  PUT  /:id     — authenticatedLimiter + admin auth + full product schema
 *  DELETE /:id   — authenticatedLimiter + admin auth
 *
 * Public product reads are rate-limited by the global limiter (server.js).
 * Write endpoints additionally validate all fields via productWriteSchema,
 * stripping unknown keys to prevent mass-assignment.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/productController');
const auth = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate }             = require('../middleware/validate');
const { productWriteSchema, productQuerySchema } = require('../validation/schemas');

// Public read — rate-limited by global limiter (server.js)
router.get('/',    validate(productQuerySchema, 'query'), ctrl.getAll);
router.get('/:id', ctrl.getOne);

// Admin-only writes — rate-limited + validated
router.post(
  '/',
  authenticatedLimiter,
  auth(['admin']),
  validate(productWriteSchema),   // name, price required; strips unknown fields
  ctrl.create
);

router.put(
  '/:id',
  authenticatedLimiter,
  auth(['admin']),
  validate(productWriteSchema),   // same schema for updates
  ctrl.update
);

router.delete(
  '/:id',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.remove
);

module.exports = router;
