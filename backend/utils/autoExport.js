'use strict';
/**
 * utils/autoExport.js
 * Fire-and-forget SQL export to GitHub.
 * Called after any mutation that changes products/orders data.
 * Does nothing if GITHUB_TOKEN / GITHUB_REPO_OWNER / GITHUB_REPO_NAME are not set.
 */

const ENABLED = !!(
  process.env.GITHUB_TOKEN &&
  process.env.GITHUB_REPO_OWNER &&
  process.env.GITHUB_REPO_NAME
);

let _exportFn = null;

/**
 * Lazy-load the export logic from export route to avoid circular deps.
 * We re-use the same buildSqlDump + push logic.
 */
async function triggerExport(reason) {
  if (!ENABLED) return;  // silently skip if not configured

  // Import inline to avoid circular deps at module load time
  const db      = require('../config/db');
  const token   = process.env.GITHUB_TOKEN;
  const owner   = process.env.GITHUB_REPO_OWNER;
  const repo    = process.env.GITHUB_REPO_NAME;
  const sqlPath = process.env.GITHUB_SQL_PATH || 'database/aqualence_complete.sql';

  // Avoid parallel exports: debounce to at most 1 per 30 seconds
  const now = Date.now();
  if (triggerExport._lastRun && now - triggerExport._lastRun < 30_000) return;
  triggerExport._lastRun = now;

  try {
    // Build SQL dump
    const { buildSqlDump } = require('./buildSqlDump');
    const sqlContent = await buildSqlDump(db);
    const encoded    = Buffer.from(sqlContent, 'utf8').toString('base64');

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${sqlPath}`;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Aqualance-AutoExport/1.0',
    };

    let sha;
    const getRes = await fetch(apiBase, { headers });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    }

    const ts   = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const body = {
      message: `auto(${reason}): db export ${ts} UTC`,
      content: encoded,
      ...(sha ? { sha } : {}),
    };

    const putRes = await fetch(apiBase, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!putRes.ok) {
      const txt = await putRes.text();
      console.warn(`[autoExport] GitHub push failed ${putRes.status}: ${txt}`);
    } else {
      console.log(`[autoExport] SQL exported to GitHub (${reason})`);
    }
  } catch (err) {
    // Never crash the main request — just log
    console.warn('[autoExport] error (non-fatal):', err.message);
  }
}
triggerExport._lastRun = 0;

module.exports = { triggerExport };
