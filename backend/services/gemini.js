/**
 * services/gemini.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side Gemini 1.5 Flash client.
 *
 * SECURITY — the API key never leaves the server:
 *   • Loaded from process.env.GEMINI_API_KEY (never hardcoded)
 *   • No client-side SDK, no key in any HTML/JS file
 *   • All requests to generativelanguage.googleapis.com go server→Gemini only
 *
 * Cost controls:
 *   • Model: gemini-2.0-flash (current model — gemini-1.5-flash deprecated Feb 2025)
 *   • Max output tokens: 350 per response (product recommendations are short)
 *   • Max conversation history: 6 turns (3 user + 3 assistant) sent to Gemini
 *   • Product catalog cached for 5 minutes (avoids a DB hit on every message)
 *   • System prompt is concise and tightly scoped
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../config/db');

/* ── Validate key at module load ─────────────────────────────────────────── */
if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌  FATAL: GEMINI_API_KEY is not set. AI features will not work.');
  } else {
    console.warn('⚠️   GEMINI_API_KEY not set — AI chat endpoint will return errors.');
  }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

const MODEL_NAME    = 'gemini-2.0-flash';  // gemini-1.5-flash deprecated Feb 2025
const MAX_TOKENS    = 350;   // cap output per response (cost + UX: keep replies concise)
const MAX_HISTORY   = 6;     // max turns to send (3 user + 3 model) — keeps context window small
const CACHE_TTL_MS  = 5 * 60 * 1000; // 5 minutes product cache

/* ── Product catalog cache ───────────────────────────────────────────────── */
let _productCache       = null;
let _productCacheExpiry = 0;

async function getProductCatalog() {
  const now = Date.now();
  if (_productCache && now < _productCacheExpiry) {
    return _productCache;
  }

  try {
    const [rows] = await db.query(
      `SELECT id, name, description, price, mrp, category, stock, unit
       FROM products
       WHERE is_active = 1
       ORDER BY category, name`
    );
    _productCache       = rows;
    _productCacheExpiry = now + CACHE_TTL_MS;
    return rows;
  } catch (err) {
    console.error('[gemini] Failed to fetch product catalog:', err.message);
    // Return cached (possibly stale) data rather than failing entirely
    return _productCache || [];
  }
}

/* ── Network bands reference (from NetWork_Bands.pdf) ───────────────────── */
const NETWORK_BANDS_KNOWLEDGE = `
NETWORK BAND REFERENCE (for technical support queries):

2G (GSM) Bands:
  • GSM 850: 824–894 MHz
  • GSM 900: 880–960 MHz  ← Used in India
  • GSM 1800: 1710–1880 MHz  ← Used in India
  • GSM 1900: 1850–1990 MHz

3G (UMTS/WCDMA) Bands:
  • Band 1: 2100 MHz  ← India primary
  • Band 5: 850 MHz
  • Band 8: 900 MHz

4G (LTE) Bands:
  • Band 3: 1800 MHz  ← Most used in India
  • Band 5: 850 MHz  ← Used in India
  • Band 8: 900 MHz
  • Band 40: 2300 MHz  ← Most used in India
  • Band 41: 2500 MHz

5G (NR – New Radio) Bands:
  • n28: 700 MHz  ← Jio India
  • n41: 2500 MHz
  • n77: 3700 MHz
  • n78: 3300–3800 MHz  ← Jio & Airtel India primary
  • n258: 26 GHz (mmWave)

6G (Future):
  • Sub-THz: 90–300 GHz
  • Terahertz: 300 GHz – 3 THz

Summary:
  2G → 850/900/1800/1900 MHz
  3G → 850/900/2100 MHz
  4G → 850/1800/2300/2500 MHz
  5G → 700/2500/3300–3800 MHz/26 GHz
  6G → 90 GHz – 3 THz (future)
`;


function buildSystemPrompt(products) {
  // Group by category for a readable catalog
  const byCategory = {};
  for (const p of products) {
    if (!byCategory[p.category]) byCategory[p.category] = [];
    byCategory[p.category].push(p);
  }

  const catalogLines = [];
  for (const [cat, items] of Object.entries(byCategory)) {
    catalogLines.push(`\n${cat}:`);
    for (const p of items) {
      const disc = p.mrp && p.mrp > p.price
        ? ` (${Math.round(((p.mrp - p.price) / p.mrp) * 100)}% off)` : '';
      const stock = p.stock <= 5 ? ' [Low stock]' : '';
      catalogLines.push(
        `  • ${p.name} — ₹${parseFloat(p.price).toFixed(0)}${disc}${stock}`
        + (p.description ? ` — ${p.description.slice(0, 80)}` : '')
      );
    }
  }

  return `You are Aria, a friendly and knowledgeable wellness product assistant for Aqualence Ventures, \
an iKrish wellness distribution company based in Sangamner, Maharashtra, India.

Your MAIN job is to help customers discover and choose iKrish wellness products. You also have knowledge \
of mobile network bands and can answer related technical questions.

STRICT RULES — you must ALWAYS follow these:
1. Only recommend products from the catalog below. Never invent products or prices.
2. Keep responses concise — 2–4 sentences maximum. Never write long paragraphs.
3. Always mention the product name and price when recommending.
4. For network band questions, use the NETWORK BAND REFERENCE below to give accurate answers.
5. If a customer asks about something unrelated to wellness products OR network bands, gently redirect: \
"I'm here to help you find the perfect iKrish product or answer network questions! How can I help?"
6. Never give medical advice, diagnoses, or prescribe treatments.
7. Never discuss competitors, politics, religion, or any topic outside wellness products and network bands.
8. Respond only in the language the customer writes in (English or Hindi).
9. If stock is marked [Low stock], mention it so customers can order promptly.

CURRENT iKrish PRODUCT CATALOG:
${catalogLines.join('\n')}
${NETWORK_BANDS_KNOWLEDGE}
When recommending products, always end your reply with: "Would you like to add any of these to your cart?"`;
}

/* ── Main chat function ──────────────────────────────────────────────────── */
/**
 * Send a message to Gemini with conversation history and product context.
 *
 * @param {string} userMessage   - The current user message (already sanitised)
 * @param {Array}  history       - Prior turns: [{ role: 'user'|'model', parts: [{text}] }]
 * @returns {{ text: string, inputTokens: number, outputTokens: number }}
 */
async function chat(userMessage, history = []) {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const products     = await getProductCatalog();
  const systemPrompt = buildSystemPrompt(products);

  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: systemPrompt,
    generationConfig: {
      maxOutputTokens: MAX_TOKENS,
      temperature:     0.7,   // balanced: creative but not hallucinatory
      topP:            0.9,
      topK:            40,
    },
    // Safety settings: block harmful content at the source
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  });

  // Trim history to the last MAX_HISTORY turns (keeps context window and cost bounded)
  const trimmedHistory = history.slice(-MAX_HISTORY);

  const chatSession = model.startChat({ history: trimmedHistory });
  const result      = await chatSession.sendMessage(userMessage);
  const response    = result.response;

  // Extract token usage for billing tracking
  const usageMeta   = response.usageMetadata || {};
  const inputTokens  = usageMeta.promptTokenCount     || 0;
  const outputTokens = usageMeta.candidatesTokenCount  || 0;

  const text = response.text();

  if (!text || text.trim().length === 0) {
    throw new Error('Empty response from Gemini');
  }

  return { text: text.trim(), inputTokens, outputTokens };
}

module.exports = { chat, getProductCatalog };