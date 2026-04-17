/**
 * routes/delivery.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security applied:
 *  All routes — authenticatedLimiter + appropriate role auth
 *
 *  POST /boys — deliveryBoySchema validation:
 *    • name (≤100 chars), phone (10-digit Indian), password (min 8 chars)
 *    • Unknown fields stripped — prevents injecting unexpected DB columns
 *
 * Note: the delivery_id / order_id URL params are parsed as integers in the
 * controller with an explicit Forbidden check (a delivery boy cannot access
 * another person's orders). No additional param schema needed here.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const express = require('express');
const router  = express.Router();

const ctrl      = require('../controllers/deliveryController');
const authCtrl  = require('../controllers/authController');
const auth = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate }             = require('../middleware/validate');
const { deliveryBoySchema, resetPasswordSchema } = require('../validation/schemas');

// Delivery boy order views
router.get(
  '/orders/:delivery_id',
  authenticatedLimiter,
  auth(['admin', 'delivery']),
  ctrl.getOrders
);

router.get(
  '/orders/:delivery_id/:order_id',
  authenticatedLimiter,
  auth(['admin', 'delivery']),
  ctrl.getOrderDetail
);

// Admin: delivery boy management
router.get(
  '/boys',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.listDeliveryBoys
);

router.post(
  '/boys',
  authenticatedLimiter,
  auth(['admin']),
  validate(deliveryBoySchema),   // name + phone + password (min 8 chars enforced)
  ctrl.addDeliveryBoy
);

router.delete(
  '/boys/:id',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.removeDeliveryBoy
);

// Fix 4: Admin resets a delivery boy's password (forces change on next login)
router.put(
  '/boys/:id/reset-password',
  authenticatedLimiter,
  auth(['admin']),
  validate(resetPasswordSchema),
  authCtrl.adminResetPassword
);

module.exports = router;
