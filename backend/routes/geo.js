/**
 * routes/geo.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security applied:
 *  All routes — authenticatedLimiter + role auth
 *
 *  Validated payloads:
 *    POST /leads     — geoLeadSchema    (shop_name, lat/lng bounds, sale_status)
 *    POST /track     — geoTrackSchema   (lat/lng only — minimal surface area)
 *    POST /validate  — geoValidateSchema (lat/lng + optional taluka_id)
 *    POST /talukas   — talukaCreateSchema (name, district, center coords, radius_km)
 *    PUT  /talukas/:id — talukaUpdateSchema (all fields optional for partial update)
 *    POST /assign/:id  — talukaAssignSchema (salesman_id)
 *
 * Coordinate fields are validated to real geographic bounds (-90..90 / -180..180),
 * preventing injection of nonsensical or malicious values into geofencing math.
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const express = require('express');
const router  = express.Router();

const ctrl = require('../controllers/geoController');
const auth = require('../middleware/auth');
const { authenticatedLimiter } = require('../middleware/rateLimiter');
const { validate }          = require('../middleware/validate');
const { photoBodyParser }   = require('../middleware/photoBodyParser');
const {
  geoLeadSchema,
  geoTrackSchema,
  geoValidateSchema,
  talukaCreateSchema,
  talukaUpdateSchema,
  talukaAssignSchema,
  mapLeadsQuerySchema,
} = require('../validation/schemas');

/* ── Salesman routes ─────────────────────────────────────────────────────── */
router.get(
  '/talukas',
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  ctrl.listTalukas
);

router.get(
  '/my-taluka',
  authenticatedLimiter,
  auth(['salesman']),
  ctrl.getMyTaluka
);

router.post(
  '/validate',
  authenticatedLimiter,
  auth(['salesman']),
  validate(geoValidateSchema),     // lat/lng + optional taluka_id (all bounds-checked)
  ctrl.validateLocation
);

router.post(
  '/leads',
  photoBodyParser,                 // 1 MB limit — accommodates photo_data + products_interested
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  validate(geoLeadSchema),         // shop_name, lat/lng (required), sale_status enum
  ctrl.addGeoLead
);

router.post(
  '/track',
  authenticatedLimiter,
  auth(['salesman']),
  validate(geoTrackSchema),        // lat/lng only — minimal required surface
  ctrl.trackLocation
);

/* ── Admin routes ────────────────────────────────────────────────────────── */
router.get(
  '/live-positions',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.livePositions
);

router.get(
  '/map-leads',
  authenticatedLimiter,
  auth(['admin']),
  // Issue 4 fix: validate all query params — from/to (ISO date), salesman_id (int),
  // limit/offset (int range). Previously unvalidated, allowing arbitrary strings
  // through to the controller's parseInt() calls.
  validate(mapLeadsQuerySchema, 'query'),
  ctrl.mapLeads
);

router.post(
  '/talukas',
  authenticatedLimiter,
  auth(['admin']),
  validate(talukaCreateSchema),    // name, district, center_lat/lng, radius_km
  ctrl.createTaluka
);

router.put(
  '/talukas/:id',
  authenticatedLimiter,
  auth(['admin']),
  validate(talukaUpdateSchema),    // all fields optional (partial update)
  ctrl.updateTaluka
);

router.delete(
  '/talukas/:id',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.deleteTaluka
);

router.post(
  '/assign/:id',
  authenticatedLimiter,
  auth(['admin']),
  validate(talukaAssignSchema),    // salesman_id (positive integer)
  ctrl.assignTaluka
);

router.get(
  '/salesmen-assignments',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.salesmenAssignments
);

// GET /api/geo/leads/:id — single lead detail with products (admin)
router.get(
  '/leads/:id',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.getLeadDetail
);

// GET /api/geo/maps-key — returns Google Maps API key for frontend geocoding
router.get(
  '/maps-key',
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  ctrl.getMapsKey
);

// GET /api/geo/verified-count — GPS verification stats for a salesman
// Salesman: own stats only. Admin: pass ?salesman_id=N for specific salesman.
router.get(
  '/verified-count',
  authenticatedLimiter,
  auth(['salesman', 'admin']),
  ctrl.getVerifiedCount
);

// GET /api/geo/verified-stats — GPS verification stats for ALL salesmen (admin)
router.get(
  '/verified-stats',
  authenticatedLimiter,
  auth(['admin']),
  ctrl.getVerifiedStats
);

module.exports = router;