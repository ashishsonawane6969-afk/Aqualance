/**
 * routes/orders.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security applied per endpoint:
 *
 *  POST /          — publicWriteLimiter (20/hr, unauthenticated guest orders)
 *                    + full order schema validation (customer fields, products array)
 *
 *  All other GET/PUT — authenticatedLimiter (200/5 min)
 *                    + schema validation on write payloads
 *
 * Input validation strips unexpected fields (mass-assignment prevention) and
 * enforces types, lengths, and enum values. See validation/schemas.js.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/orderController');
const auth = require('../middleware/auth');
const { publicWriteLimiter, authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const {
  orderCreateSchema,
  orderAssignSchema,
  orderStatusSchema,
  orderQuerySchema,
} = require('../validation/schemas');

// POST /api/orders — public guest endpoint (no auth required)
router.post(
  '/',
  publicWriteLimiter,               // 20 orders/hr per IP
  validate(orderCreateSchema),      // validates all customer fields + products array
  ctrl.create
);

// All authenticated order routes
router.get('/stats',        authenticatedLimiter, auth(['admin']),            ctrl.getStats);
router.get('/overview',     authenticatedLimiter, auth(['admin']),            ctrl.getOverview);
router.get('/leaderboard',  authenticatedLimiter, auth(['admin']),            ctrl.getLeaderboard);
router.get('/',             authenticatedLimiter, auth(['admin']), validate(orderQuerySchema, 'query'), ctrl.getAll);
router.get('/:id',          authenticatedLimiter, auth(['admin','delivery']), ctrl.getOne);

router.put(
  '/assign-delivery',
  authenticatedLimiter,
  auth(['admin']),
  validate(orderAssignSchema),      // order_id + delivery_id (both positive integers)
  ctrl.assignDelivery
);

router.put(
  '/update-status',
  authenticatedLimiter,
  auth(['admin','delivery']),
  validate(orderStatusSchema),      // order_id + enum status
  ctrl.updateStatus
);

module.exports = router;
