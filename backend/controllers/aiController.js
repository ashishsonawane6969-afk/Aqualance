/**
 * controllers/aiController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles all AI-powered features:
 *   POST /api/ai/chat           — public customer product recommendation chat
 *   GET  /api/ai/budget-status  — admin: view daily token budget usage
 *
 * Security model:
 *   • All chat requests pass through aiProtection middleware (6 layers) before
 *     reaching this controller — no additional auth needed for the public endpoint
 *   • budget-status requires admin JWT — never expose billing data publicly
 *   • Input is validated by aiChatSchema before this controller runs
 *   • Gemini API key is only referenced in services/gemini.js — never here
 *   • Token usage is reconciled: Layer 4 pre-reserves 200 tokens, then we
 *     adjust with actuals after the Gemini response arrives
 *   • Any error from Gemini returns a safe generic message — never leak
 *     Gemini error details (may contain API key hints or quota info) to clients
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const gemini             = require('../services/gemini');
const { serverError }    = require('../utils/errors');
const { recordTokenUsage, getTokenBudgetStatus } = require('../middleware/aiRateLimiter');

/* ── POST /api/ai/chat ───────────────────────────────────────────────────── */
exports.chat = async (req, res) => {
  const { message, history } = req.body;
  // message and history already validated + stripped by aiChatSchema middleware

  try {
    const { text, inputTokens, outputTokens } = await gemini.chat(message, history);

    // Reconcile token reservation: Layer 4 reserved 200 tokens as a pre-flight
    // estimate. Adjust with actuals so the daily budget stays accurate.
    const actualTokens = inputTokens + outputTokens;
    const reserved     = req._aiTokenReservation || 200;
    const adjustment   = actualTokens - reserved;
    if (adjustment !== 0) {
      // recordTokenUsage adds to the budget — pass a negative to release
      // the over-reservation if actuals were less than estimated
      recordTokenUsage(Math.max(0, adjustment), 0);
    }

    // Log token usage for monitoring (never log the message content — may contain PII)
    console.info(
      `[aiController] chat — IP: ${req.ip} — ` +
      `in: ${inputTokens} out: ${outputTokens} total: ${actualTokens} tokens`
    );

    return res.json({
      success: true,
      reply:   text,
      // Expose token counts so the client can show a lightweight usage indicator
      usage: { inputTokens, outputTokens },
    });

  } catch (err) {
    // Release the token pre-reservation on error (request didn't cost anything)
    const reserved = req._aiTokenReservation || 0;
    if (reserved > 0) {
      recordTokenUsage(-reserved, 0); // negative = release
    }

    // Classify error for logging without exposing details to client
    const errMsg = err.message || '';

    // ── Key not set or placeholder ───────────────────────────────────────────
    if (errMsg.includes('API_KEY') || errMsg.includes('not configured')) {
      console.error('[aiController] Gemini API key not configured');
      return res.status(503).json({
        success: false, errorCode: 'AI_NOT_CONFIGURED',
        message: 'The AI assistant is not available right now.',
      });
    }

    // ── Invalid API key (Google returns 400 + API_KEY_INVALID) ────────────────
    if (errMsg.includes('API_KEY_INVALID') || errMsg.includes('API key not valid') ||
        errMsg.includes('INVALID_ARGUMENT') || errMsg.includes('[400]')) {
      console.error('[aiController] Invalid Gemini API key — check GEMINI_API_KEY in .env');
      return res.status(503).json({
        success: false, errorCode: 'AI_NOT_CONFIGURED',
        message: 'The AI assistant is not available right now.',
      });
    }

    // ── Network / fetch error — check quota FIRST before generic fetch match ────
    // Important: quota errors come as "Error fetching from ...[429 Too Many Requests]"
    // so the [429]/quota check MUST run before the generic 'Error fetching from' check,
    // otherwise quota errors get misclassified as network errors.
    if (errMsg.includes('429') || errMsg.includes('quota') ||
        errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('Too Many Requests')) {
      console.warn('[aiController] Gemini quota exceeded');
      return res.status(429).json({
        success: false, errorCode: 'AI_QUOTA_EXCEEDED',
        message: 'The AI assistant is busy right now. Please try again in a minute.',
      });
    }

    if (errMsg.includes('fetch failed') || errMsg.includes('Error fetching from') ||
        errMsg.includes('ENOTFOUND')    || errMsg.includes('ETIMEDOUT') ||
        errMsg.includes('ECONNREFUSED') || errMsg.includes('Failed to fetch')) {
      console.error('[aiController] Gemini network error:', errMsg.split('\n')[0]);
      return res.status(503).json({
        success: false, errorCode: 'AI_UNAVAILABLE',
        message: 'The AI assistant is temporarily unavailable. Please try again.',
      });
    }

    // ── Model not found (deprecated or wrong name) ────────────────────────────
    if (errMsg.includes('not found') || errMsg.includes('[404]') ||
        errMsg.includes('MODEL_NOT_FOUND') || errMsg.includes('is not found')) {
      console.error('[aiController] Gemini model not found — model may be deprecated');
      return res.status(503).json({
        success: false, errorCode: 'AI_UNAVAILABLE',
        message: 'The AI assistant is temporarily unavailable.',
      });
    }

    // ── Safety block ──────────────────────────────────────────────────────────
    if (errMsg.includes('SAFETY') || errMsg.includes('blocked')) {
      return res.status(400).json({
        success: false, errorCode: 'AI_CONTENT_BLOCKED',
        message: "I can only help with iKrish wellness product questions. How can I help you today?",
      });
    }

    // ── Anything else — log server-side, return clean 503 (not 500) ───────────
    console.error('[aiController] Unexpected Gemini error:', errMsg.split('\n')[0]);
    return res.status(503).json({
      success: false, errorCode: 'AI_ERROR',
      message: 'The AI assistant is temporarily unavailable. Please try again.',
    });
  }
};

/* ── GET /api/ai/budget-status (admin only) ──────────────────────────────── */
exports.budgetStatus = (req, res) => {
  // Auth enforced by route middleware — only admin reaches here
  const status = getTokenBudgetStatus();
  res.json({ success: true, data: status });
};