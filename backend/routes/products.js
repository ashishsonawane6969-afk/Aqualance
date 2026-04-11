'use strict';

const express = require('express');
const router  = express.Router();

const ctrl        = require('../controllers/productController');
const variantCtrl = require('../controllers/variantController');
const bundleCtrl  = require('../controllers/bundleController');
const auth        = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const {
  productWriteSchema,
  productQuerySchema,
  variantBulkSchema,
  bundleItemsSchema,
} = require('../validation/schemas');

// ── Product CRUD ─────────────────────────────────────────────
router.get('/',    validate(productQuerySchema, 'query'), ctrl.getAll);
router.get('/:id', ctrl.getOne);

router.post('/',      authenticatedLimiter, auth(['admin']), validate(productWriteSchema), ctrl.create);
router.put('/:id',   authenticatedLimiter, auth(['admin']), validate(productWriteSchema), ctrl.update);
router.delete('/:id', authenticatedLimiter, auth(['admin']), ctrl.remove);

// ── Variant sub-routes ────────────────────────────────────────
router.get('/:id/variants',    variantCtrl.list);
router.post('/:id/variants',   authenticatedLimiter, auth(['admin']), validate(variantBulkSchema), variantCtrl.bulkUpsert);
router.delete('/:id/variants/:variantId', authenticatedLimiter, auth(['admin']), variantCtrl.remove);

// ── Bundle item sub-routes ────────────────────────────────────
router.get('/:id/bundle-items',    bundleCtrl.list);
router.post('/:id/bundle-items',   authenticatedLimiter, auth(['admin']), validate(bundleItemsSchema), bundleCtrl.bulkSave);
router.delete('/:id/bundle-items/:itemId', authenticatedLimiter, auth(['admin']), bundleCtrl.removeItem);

module.exports = router;
