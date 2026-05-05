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
// SECURITY FIX: Override the global 30MB body limit with a tight 50KB cap.
// Order JSON (customer fields + up to 50 product refs) is at most a few KB.
// Without this, any IP can hammer the server with 30MB payloads at the rate
// limit (20/hr) before the publicWriteLimiter can respond — forcing expensive
// JSON parsing on each request.
router.post(
  '/',
  express.json({ limit: '50kb' }),  // tight cap — order payload is always tiny
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
