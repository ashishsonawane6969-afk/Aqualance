/**
 * middleware/aiRateLimiter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Six-layer protection stack for the public AI chat endpoint.
 *
 * AI endpoints are uniquely dangerous because:
 *   1. They are typically unauthenticated (public chat widget)
 *   2. Each request generates real billing costs (tokens)
 *   3. A single automated script can drain a daily API budget in seconds
 *   4. Standard request-count rate limits alone are insufficient — a short burst
 *      of long prompts costs more than many short ones
 *
 * Layers applied in order (request must pass ALL layers):
 *
 *   Layer 1 — Per-IP burst limiter       5 req / 60 sec   (rapid-fire bots)
 *   Layer 2 — Per-IP hourly limiter      20 req / hr      (sustained scrapers)
 *   Layer 3 — Per-session daily limiter  50 req / 24 hr   (session abuse)
 *   Layer 4 — Global daily token budget  100K tok / day   (billing runaway)
 *   Layer 5 — Minimum message interval   2 sec cooldown   (automation cadence)
 *   Layer 6 — Prompt injection scanner   blocklist scan   (jailbreak / exfil)
 *
 * For multi-node production, replace the in-memory stores (Map, counters) with
 * Redis. The express-rate-limit package supports rate-limit-redis with an
 * identical API surface for layers 1–3.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const rateLimit = require('express-rate-limit');

/* ══════════════════════════════════════════════════════════════════════════════
   LAYER 1 — Per-IP burst limiter
   Stops scripts that fire requests in tight loops (e.g. while(true) fetch(...))
══════════════════════════════════════════════════════════════════════════════ */
const aiBurstLimiter = rateLimit({
  windowMs:        60 * 1000,   // 1 minute window
  max:             20,           // ↑ 5→20 messages per minute per IP
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      success:   false,
      errorCode: 'AI_BURST_LIMIT',
      message:   'You are sending messages too quickly. Please wait a moment.',
      retryAfter: 60,
    });
  },
  skip: (req) => req.method === 'OPTIONS',
});

/* ══════════════════════════════════════════════════════════════════════════════
   LAYER 2 — Per-IP hourly limiter
   Stops sustained scraping campaigns that stay under the burst threshold.
══════════════════════════════════════════════════════════════════════════════ */
const aiHourlyLimiter = rateLimit({
  windowMs:        60 * 60 * 1000, // 1 hour
  max:             100,             // ↑ 20→100 messages per hour per IP
  standardHeaders: 'draft-7',
  legacyHeaders:   false,
  keyGenerator:    (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({
      success:   false,
      errorCode: 'AI_HOURLY_LIMIT',
      message:   'Hourly message limit reached. Please try again later.',
      retryAfter: 3600,
    });
  },
});

/* ══════════════════════════════════════════════════════════════════════════════
   LAYER 3 — Per-session daily limiter
══════════════════════════════════════════════════════════════════════════════ */
const SESSION_DAILY_LIMIT = 200; // ↑ 50→200 messages per session per 24 hours
const sessionDailyStore   = new Map(); // key → { count, resetAt }

function getSessionKey(req) {
  const sessionId = req.headers['x-session-id'];
  // Validate: must be a UUID-shaped string (prevents header injection)
  const isValidUUID = sessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
  return `${req.ip}:${isValidUUID ? sessionId : 'no-session'}`;
}

function sessionDailyLimiter(req, res, next) {
  const key   = getSessionKey(req);
  const now   = Date.now();
  const entry = sessionDailyStore.get(key) || { count: 0, resetAt: now + 24 * 60 * 60 * 1000 };

  // Reset counter if the 24-hour window has elapsed
  if (now > entry.resetAt) {
    entry.count   = 0;
    entry.resetAt = now + 24 * 60 * 60 * 1000;
  }

  entry.count++;
  sessionDailyStore.set(key, entry);

  if (entry.count > SESSION_DAILY_LIMIT) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return res.status(429).json({
      success:    false,
      errorCode:  'AI_SESSION_DAILY_LIMIT',
      message:    `Daily message limit (${SESSION_DAILY_LIMIT}) reached. Resets in ${Math.ceil(retryAfter / 3600)} hours.`,
      retryAfter,
    });
  }

  // Expose remaining count to client so UI can show a helpful indicator
  res.setHeader('X-AI-Session-Remaining', Math.max(0, SESSION_DAILY_LIMIT - entry.count));
  next();
}

// Prune expired sessions periodically to prevent unbounded memory growth
// Runs every 30 minutes; removes entries whose reset window has passed
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of sessionDailyStore) {
    if (now > entry.resetAt) sessionDailyStore.delete(key);
  }
}, 30 * 60 * 1000);

/* ══════════════════════════════════════════════════════════════════════════════
   LAYER 4 — Global daily token budget
   Tracks ESTIMATED tokens consumed across ALL requests today.
   Resets at midnight UTC. When the budget is exceeded the endpoint returns 503
   ("service temporarily unavailable") rather than 429 — this is intentional:
   it signals a capacity issue, not a per-user abuse signal.

   Token estimation: input tokens ≈ message chars / 4 (rough but conservative).
   Actual usage is updated after each Gemini response via recordTokenUsage().

   Default budget: 100,000 tokens/day ≈ $0.01 with gemini-1.5-flash pricing.
   Override with AI_DAILY_TOKEN_BUDGET env var.
══════════════════════════════════════════════════════════════════════════════ */
let _tokenBudget = {
  used:    0,
  limit:   parseInt(process.env.AI_DAILY_TOKEN_BUDGET, 10) || 500_000, // ↑ 100K→500K tokens/day
  resetAt: _nextMidnightUTC(),
};

function _nextMidnightUTC() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function _resetBudgetIfNewDay() {
  if (Date.now() > _tokenBudget.resetAt) {
    _tokenBudget.used    = 0;
    _tokenBudget.resetAt = _nextMidnightUTC();
    console.info(`[aiRateLimiter] Daily token budget reset. Limit: ${_tokenBudget.limit.toLocaleString()} tokens.`);
  }
}

/**
 * Called by aiController after a successful Gemini response to record actual
 * token usage. This is more accurate than the pre-request estimation.
 * @param {number} inputTokens
 * @param {number} outputTokens
 */
function recordTokenUsage(inputTokens, outputTokens) {
  _resetBudgetIfNewDay();
  _tokenBudget.used += (inputTokens || 0) + (outputTokens || 0);
  const pct = ((_tokenBudget.used / _tokenBudget.limit) * 100).toFixed(1);
  if (pct >= 80) {
    console.warn(`[aiRateLimiter] Token budget at ${pct}% (${_tokenBudget.used.toLocaleString()} / ${_tokenBudget.limit.toLocaleString()})`);
  }
}

/**
 * Returns current token budget status (for health check / admin visibility).
 */
function getTokenBudgetStatus() {
  _resetBudgetIfNewDay();
  return {
    used:       _tokenBudget.used,
    limit:      _tokenBudget.limit,
    remaining:  Math.max(0, _tokenBudget.limit - _tokenBudget.used),
    percentUsed: ((_tokenBudget.used / _tokenBudget.limit) * 100).toFixed(1),
    resetsAt:   new Date(_tokenBudget.resetAt).toISOString(),
  };
}

function tokenBudgetGuard(req, res, next) {
  _resetBudgetIfNewDay();

  // Pre-flight estimation: each message costs at minimum ~200 tokens (system
  // prompt overhead + short query + short response). Actual is tracked after.
  const estimatedCost = 200;

  if (_tokenBudget.used + estimatedCost > _tokenBudget.limit) {
    const retryAfter = Math.ceil((_tokenBudget.resetAt - Date.now()) / 1000);
    console.warn('[aiRateLimiter] Global daily token budget exhausted. Blocking request.');
    return res.status(503).json({
      success:    false,
      errorCode:  'AI_BUDGET_EXHAUSTED',
      message:    'The AI assistant is temporarily unavailable. Please try again tomorrow.',
      retryAfter,
    });
  }

  // Reserve the estimated cost optimistically — released if request fails
  _tokenBudget.used += estimatedCost;
  // Store the reservation so the controller can adjust it with actuals
  req._aiTokenReservation = estimatedCost;
  next();
}

/* ══════════════════════════════════════════════════════════════════════════════
   LAYER 5 — Minimum message interval (per IP)
   Enforces a 2-second gap between consecutive messages from the same IP.
   Simple automation scripts typically send requests as fast as the server
   responds. Real human typing has natural latency of 3–30+ seconds.
══════════════════════════════════════════════════════════════════════════════ */
const MIN_INTERVAL_MS = 500; // ↓ 2000→500ms between messages
const lastSeenStore   = new Map(); // IP → last request timestamp

function minIntervalGuard(req, res, next) {
  const now      = Date.now();
  const lastSeen = lastSeenStore.get(req.ip) || 0;
  const elapsed  = now - lastSeen;

  if (elapsed < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - elapsed;
    return res.status(429).json({
      success:    false,
      errorCode:  'AI_TOO_FAST',
      message:    'Please wait a moment before sending another message.',
      retryAfter: Math.ceil(waitMs / 1000),
    });
  }

  lastSeenStore.set(req.ip, now);
  next();
}

// Prune lastSeenStore every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [ip, ts] of lastSeenStore) {
    if (ts < cutoff) lastSeenStore.delete(ip);
  }
}, 10 * 60 * 1000);

/* ══════════════════════════════════════════════════════════════════════════════
   LAYER 6 — Prompt injection & jailbreak detection
   Scans message content for patterns associated with:
     - Instruction override attacks ("ignore previous instructions")
     - Role-play jailbreaks ("pretend you are", "you are now DAN")
     - System prompt exfiltration ("repeat your instructions", "what is your prompt")
     - Indirect injection (attempting to get the model to output sensitive data)

   This is a defence-in-depth measure. The primary protection is the server-side
   system prompt which explicitly scopes the model's role. This layer catches
   obvious attempts before they reach Gemini at all, saving tokens and providing
   an audit trail.
══════════════════════════════════════════════════════════════════════════════ */
const INJECTION_PATTERNS = [
  // Instruction override
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|directives?)/i,
  /disregard\s+(all\s+)?(previous|prior|above|your)/i,
  /forget\s+(all\s+)?(previous|prior|above|your|everything)/i,
  /override\s+(your\s+)?(instructions?|system|prompt)/i,

  // Role-play jailbreaks
  /you\s+are\s+now\s+(?!a\s+helpful|an?\s+AI|a\s+product|a\s+wellness)/i,
  /pretend\s+(you\s+are|to\s+be|that\s+you)/i,
  /act\s+as\s+(if\s+you\s+are|a\s+different|an?\s+unrestricted)/i,
  /\bDAN\b/,            // "Do Anything Now" jailbreak
  /jailbreak/i,
  /developer\s+mode/i,
  /god\s+mode/i,

  // Prompt / system exfiltration
  /repeat\s+(your|the)\s+(system\s+)?(prompt|instructions?|context)/i,
  /what\s+(are|is)\s+(your|the)\s+(system\s+)?(prompt|instructions?)/i,
  /print\s+(your|the)\s+(system\s+)?(prompt|instructions?)/i,
  /show\s+(me\s+)?(your|the)\s+(system\s+)?(prompt|instructions?|context)/i,
  /reveal\s+(your|the)\s+(prompt|instructions?|system)/i,

  // Context window dump
  /output\s+(everything|all\s+(text|content))\s+(above|before|prior)/i,
  /translate\s+(everything|the\s+(above|previous))\s+to/i,
];

function promptInjectionGuard(req, res, next) {
  const message = (req.body?.message || '').trim();

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) {
      // Log for audit — do NOT echo the message back (could leak PII)
      console.warn(
        `[aiRateLimiter] Prompt injection attempt blocked — IP: ${req.ip} ` +
        `— pattern: ${pattern.source.slice(0, 40)} — ${new Date().toISOString()}`
      );
      return res.status(400).json({
        success:   false,
        errorCode: 'AI_PROMPT_BLOCKED',
        message:   "I'm here to help with iKrish product recommendations. How can I help you today?",
      });
    }
  }

  next();
}

/* ══════════════════════════════════════════════════════════════════════════════
   COMBINED MIDDLEWARE STACK
   Apply in order: fast checks first, expensive checks last.
══════════════════════════════════════════════════════════════════════════════ */

/**
 * Full AI protection stack as an array of middleware.
 * Usage in route: router.post('/chat', ...aiProtection, ctrl.chat)
 */
const aiProtection = [
  aiBurstLimiter,        // Layer 1: fast, in-memory, rejects tight loops
  aiHourlyLimiter,       // Layer 2: fast, in-memory, rejects sustained scrapers
  sessionDailyLimiter,   // Layer 3: per-session 24hr cap
  tokenBudgetGuard,      // Layer 4: global billing protection
  minIntervalGuard,      // Layer 5: human-cadence enforcement
  promptInjectionGuard,  // Layer 6: jailbreak / exfil scan (reads req.body)
];

module.exports = {
  aiProtection,
  recordTokenUsage,
  getTokenBudgetStatus,
};
