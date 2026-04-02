'use strict';

const express = require('express');
const router  = express.Router();



const ctrl = require('../controllers/productController');



const auth = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { productWriteSchema, productQuerySchema } = require('../validation/schemas');

// backend/routes/products.js — append after the existing require() lines

// GET /api/v1/products — public product listing
router.get('/', validate(productQuerySchema, 'query'), ctrl.getAll);

// GET /api/v1/products/:id — public single product
router.get('/:id', ctrl.getOne);

// POST /api/v1/products — admin only
router.post('/', authenticatedLimiter, auth(['admin']),
  validate(productWriteSchema), ctrl.create);

// PUT /api/v1/products/:id — admin only
router.put('/:id', authenticatedLimiter, auth(['admin']),
  validate(productWriteSchema), ctrl.update);

// DELETE /api/v1/products/:id — admin only
router.delete('/:id', authenticatedLimiter, auth(['admin']), ctrl.remove);

module.exports = router; // ← THIS LINE WAS MISSING
