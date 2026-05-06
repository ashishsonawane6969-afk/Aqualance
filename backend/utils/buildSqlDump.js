'use strict';
/**
 * utils/buildSqlDump.js
 * Builds a mysqldump-style SQL string from the live DB.
 * Used by both export route and autoExport utility.
 *
 * SECURITY: Tables containing credentials or session tokens are NEVER exported.
 * Exporting password hashes, MFA secrets, or JTI revocations to an external
 * repository is a critical credential exposure risk.
 */

// Tables that must NEVER appear in the exported dump.
// Adding a table here is permanent — do not remove entries.
const EXCLUDED_TABLES = new Set([
  'users',             // bcrypt hashes, encrypted MFA secrets, phone numbers
  'token_revocations', // active JTI values — leaks session state
  'otp_pending',       // live bcrypt-hashed OTP codes
]);

async function buildSqlDump(db) {
  const lines = [];
  const ts    = new Date().toISOString();

  lines.push(`-- Aqualance DB export — generated ${ts}`);
  lines.push(`-- Auto-exported by Aqualance backend`);
  lines.push(`-- NOTE: Security-sensitive tables (users, token_revocations, otp_pending) are excluded.`);
  lines.push('');
  lines.push('SET FOREIGN_KEY_CHECKS=0;');
  lines.push('SET SQL_MODE="NO_AUTO_VALUE_ON_ZERO";');
  lines.push('');

  const [tables] = await db.query('SHOW TABLES');
  const tableNames = tables.map(r => Object.values(r)[0]);

  for (const table of tableNames) {
    // SECURITY FIX: skip credential/session tables entirely
    if (EXCLUDED_TABLES.has(table)) {
      lines.push(`-- Table \`${table}\` excluded from export (security-sensitive — contains credentials or session tokens)`);
      lines.push('');
      continue;
    }

    const [[, createRow]] = await db.query(`SHOW CREATE TABLE \`${table}\``);
    const ddl = Object.values(createRow)[1];
    lines.push(`-- Table: ${table}`);
    lines.push(`DROP TABLE IF EXISTS \`${table}\`;`);
    lines.push(ddl + ';');
    lines.push('');

    const [rows] = await db.query(`SELECT * FROM \`${table}\``);
    if (rows.length === 0) continue;

    const cols = Object.keys(rows[0]).map(c => `\`${c}\``).join(', ');
    const valueSets = rows.map(row => {
      const vals = Object.values(row).map(v => {
        if (v === null) return 'NULL';
        if (typeof v === 'number') return String(v);
        if (v instanceof Date) return `'${v.toISOString().replace('T', ' ').slice(0, 19)}'`;
        const escaped = db.escape ? db.escape(v) : `'${String(v).replace(/'/g, "''")}'`;
        return escaped;
      });
      return `(${vals.join(', ')})`;
    });

    for (let i = 0; i < valueSets.length; i += 100) {
      const batch = valueSets.slice(i, i + 100);
      lines.push(`INSERT INTO \`${table}\` (${cols}) VALUES`);
      lines.push(batch.join(',\n') + ';');
      lines.push('');
    }
  }

  lines.push('SET FOREIGN_KEY_CHECKS=1;');
  lines.push('');
  return lines.join('\n');
}

module.exports = { buildSqlDump };
