/**
 * routes/ai.js
 * ─────────────────────────────────────────────────────────────────────────────
 * AI feature routes.
 *
 * POST /api/ai/chat          — public (customer chat widget)
 * GET  /api/ai/budget-status — admin only (token budget visibility)
 *
 * Middleware chain for /chat:
 *   aiProtection (6 layers) → validate(aiChatSchema) → ctrl.chat
 *
 *   The aiProtection layers run BEFORE schema validation intentionally:
 *   - Rate limits and prompt injection checks don't need a parsed body
 *   - Rejecting abusive requests before Joi parsing is marginally cheaper
 *   - The token budget guard (Layer 4) must run before any Gemini call
 *
 * Note: express.json() body parsing is applied globally in server.js.
 *   The 100kb body limit there is sufficient — aiChatSchema caps message at
 *   500 chars and history at 12 turns × 2000 chars = ~24KB max realistic payload.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const express = require('express');
const router  = express.Router();

const ctrl                  = require('../controllers/aiController');
const auth                  = require('../middleware/auth');
const { aiProtection }      = require('../middleware/aiRateLimiter');
const { validate }          = require('../middleware/validate');
const { aiChatSchema }      = require('../validation/schemas');

/* ── Public: customer product recommendation chat ───────────────────────── */
router.post(
  '/chat',
  ...aiProtection,              // 6-layer protection (burst, hourly, session, budget, interval, injection)
  validate(aiChatSchema),       // schema: message (2–500 chars), history (max 12 turns)
  ctrl.chat
);

/* ── Admin: token budget visibility ─────────────────────────────────────── */
router.get(
  '/budget-status',
  auth(['admin']),
  ctrl.budgetStatus
);

module.exports = router;
