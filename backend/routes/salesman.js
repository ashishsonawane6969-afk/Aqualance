/**
 * routes/salesman.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security applied:
 *  All routes — authenticatedLimiter + role auth
 *
 *  Validated payloads:
 *    POST /leads          — leadCreateSchema  (all required fields + mobile regex)
 *    PUT  /leads/:id      — leadUpdateSchema  (same fields but all optional)
 *    POST /add            — salesmanCreateSchema (name, phone, password ≥8 chars)
 *    POST /areas/:id      — areaAssignSchema  (taluka + district)
 *    GET  /leads (query)  — leadsQuerySchema  (date range, sale_status enum, etc.)
 *    GET  /report (query) — reportQuerySchema (ISO date range only)
 *
 * stripUnknown:true on all schemas prevents extra fields reaching the DB.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const express = require('express');
const router  = express.Router();

const ctrl     = require('../controllers/salesmanController');
const authCtrl = require('../controllers/authController');
const auth = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate }          = require('../middleware/validate');
const { photoBodyParser }   = require('../middleware/photoBodyParser');
const {
  salesmanCreateSchema,
  leadCreateSchema,
  leadUpdateSchema,
  areaAssignSchema,
  reportQuerySchema,
  leadsQuerySchema,
  resetPasswordSchema,
} = require('../validation/schemas');

/* ── Leads ───────────────────────────────────────────────────────────────── */
router.post(
  '/leads',
  photoBodyParser,                 // 300 KB limit — accommodates base64 photo_proof (≤200 KB)
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  validate(leadCreateSchema),      // shop_name, owner_name, mobile, village, taluka, district
  ctrl.addLead
);

router.get(
  '/leads',
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  validate(leadsQuerySchema, 'query'), // from/to dates, sale_status enum, district/taluka
  ctrl.getLeads
);

router.get(
  '/leads/:id',
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  ctrl.getLead
);

router.put(
  '/leads/:id',
  photoBodyParser,                 // 300 KB limit — accommodates base64 photo_proof (≤200 KB)
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  validate(leadUpdateSchema),      // all fields optional (partial update)
  ctrl.updateLead
);

router.delete(
  '/leads/:id',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.deleteLead
);

/* ── Reports ─────────────────────────────────────────────────────────────── */
router.get(
  '/report',
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  validate(reportQuerySchema, 'query'), // from/to ISO dates
  ctrl.getReport
);

/* ── Salesman management (admin only) ────────────────────────────────────── */
router.get(
  '/list',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.listSalesmen
);

router.post(
  '/add',
  authenticatedLimiter,
  auth(['admin']),
  validate(salesmanCreateSchema),  // name, phone (10-digit), password (≥8 chars)
  ctrl.addSalesman
);

router.delete(
  '/remove/:id',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.removeSalesman
);

/* ── Taluka / Area assignment ─────────────────────────────────────────────── */
router.get(
  '/my-areas',
  authenticatedLimiter,
  auth(['salesman']),
  ctrl.getMyAreas
);

router.get(
  '/areas/:id',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.getSalesmanAreas
);

router.post(
  '/areas/:id',
  authenticatedLimiter,
  auth(['admin']),
  validate(areaAssignSchema),      // taluka + district (both required, trimmed)
  ctrl.assignArea
);

router.delete(
  '/areas/:id/:areaId',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.removeArea
);

// Fix 4: Admin resets a salesman's password (forces change on next login)
router.put(
  '/reset-password/:id',
  authenticatedLimiter,
  auth(['admin']),
  validate(resetPasswordSchema),
  authCtrl.adminResetPassword
);

module.exports = router;
