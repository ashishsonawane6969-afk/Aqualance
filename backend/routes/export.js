'use strict';
/**
 * routes/export.js
 * POST /api/v1/export/sql-to-github
 * Admin-only: dumps live DB and pushes SQL to GitHub.
 * Required env vars: GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME
 * Optional: GITHUB_SQL_PATH (default: database/aqualence_complete.sql)
 */

const express          = require('express');
const router           = express.Router();
const db               = require('../config/db');
const auth             = require('../middleware/auth');
const { buildSqlDump } = require('../utils/buildSqlDump');

const GITHUB_SQL_PATH = process.env.GITHUB_SQL_PATH || 'database/aqualence_complete.sql';

router.post('/sql-to-github', auth(['admin']), async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo  = process.env.GITHUB_REPO_NAME;

  if (!token || !owner || !repo) {
    return res.status(501).json({
      success: false,
      message: 'GitHub export not configured. Set GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME in environment.',
    });
  }

  try {
    const sqlContent = await buildSqlDump(db);
    const encoded    = Buffer.from(sqlContent, 'utf8').toString('base64');

    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${GITHUB_SQL_PATH}`;
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
      message: `manual export: ${ts} UTC`,
      content: encoded,
      ...(sha ? { sha } : {}),
    };

    const putRes = await fetch(apiBase, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub API ${putRes.status}: ${errText}`);
    }

    res.json({ success: true, message: 'SQL exported to GitHub successfully.' });
  } catch (err) {
    console.error('[export] sql-to-github error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
