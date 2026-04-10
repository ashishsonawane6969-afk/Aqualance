'use strict';

const express = require('express');
const router  = express.Router();

const ctrl        = require('../controllers/productController');
const auth        = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { productWriteSchema, productQuerySchema, variantBulkSchema } = require('../validation/schemas');

// ── Product CRUD ────────────────────────────────────────────
router.get('/',    validate(productQuerySchema, 'query'), ctrl.getAll);
router.get('/:id', ctrl.getOne);

router.post('/',    authenticatedLimiter, auth(['admin']), validate(productWriteSchema), ctrl.create);
router.put('/:id',  authenticatedLimiter, auth(['admin']), validate(productWriteSchema), ctrl.update);
router.delete('/:id', authenticatedLimiter, auth(['admin']), ctrl.remove);

module.exports = router;
