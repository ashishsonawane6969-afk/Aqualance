'use strict';

/* ═══════════════════════════════════════════════════════════════
   productController.js — Enhanced
   GET /api/products        — list all active products (structured JSON)
   GET /api/products/:id    — single product detail (incl. images)
   POST/PUT/DELETE          — admin-only CRUD
   All responses: { success: true, data: ..., count?: N }
   ═══════════════════════════════════════════════════════════════ */

const db           = require('../config/db');
const { serverError } = require('../utils/errors');

/* ── Helpers ─────────────────────────────────────────────── */
function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

/* ── Column availability check (run once at startup) ────────── */
let _cols = null; // cache: set of column names present in products table

async function _getProductCols() {
  if (_cols) return _cols;
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products'`
    );
    _cols = new Set(rows.map(r => r.COLUMN_NAME));
  } catch (e) {
    _cols = new Set(['id','name','description','price','image','category','stock','is_active','created_at']);
  }
  return _cols;
}

/* ── GET /api/products ────────────────────────────────────── */
exports.getAll = async (req, res) => {
  try {
    const { category, search } = req.query;
    const cols = await _getProductCols();

    // Only select columns that actually exist in the table
    const selectCols = [
      'id', 'name', 'description', 'price', 'category', 'stock', 'is_active', 'created_at',
      ...(cols.has('mrp')    ? ['mrp']    : []),
      ...(cols.has('image')  ? ['image']  : []),
      ...(cols.has('images') ? ['images'] : []),
      ...(cols.has('unit')   ? ['unit']   : []),
    ].join(', ');

    let sql    = `SELECT ${selectCols} FROM products WHERE is_active = 1`;
    const params = [];

    if (category && category !== 'All') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (search && search.trim()) {
      sql += ' AND (name LIKE ? OR category LIKE ? OR description LIKE ?)';
      const like = '%' + search.trim() + '%';
      params.push(like, like, like);
    }

    sql += ' ORDER BY category, name';

    const [rows] = await db.query(sql, params);

    /* Structured response — frontend reads json.data */
    res.json({
      success: true,
      data:    rows,
      count:   rows.length,
    });

  } catch (err) {
    console.error('[productController.getAll]', err.message);
    serverError(res, err, '[productController.getAll]');
  }
};

/* ── GET /api/products/:id ────────────────────────────────── */
exports.getOne = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return sendError(res, 400, 'Invalid product ID');

    // SELECT * is fine for single-product detail — all columns needed
    const [rows] = await db.query(
      'SELECT * FROM products WHERE id = ? AND is_active = 1',
      [id]
    );

    if (!rows.length) return sendError(res, 404, 'Product not found');

    /* Structured response — frontend reads json.data */
    res.json({ success: true, data: rows[0] });

  } catch (err) {
    console.error('[productController.getOne]', err.message);
    serverError(res, err, '[productController.getOne]');
  }
};

/* ── POST /api/products  (admin only) ─────────────────────── */
exports.create = async (req, res) => {
  try {
    const { name, description, price, mrp, image, images, category, stock, unit } = req.body;

    // Fields validated by productWriteSchema middleware — no re-check needed
    // images: optional JSON array of extra image URLs
    let imagesVal = null;
    if (images) {
      try {
        const arr = Array.isArray(images) ? images : JSON.parse(images);
        imagesVal = JSON.stringify(arr);
      } catch { /* ignore invalid JSON */ }
    }

    const [result] = await db.query(
      `INSERT INTO products (name, description, price, mrp, image, images, category, stock, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        description || '',
        parseFloat(price),
        mrp  ? parseFloat(mrp)  : null,
        image || '',
        imagesVal,
        category || 'General',
        parseInt(stock) || 100,
        unit    || 'piece',
      ]
    );

    res.status(201).json({ success: true, id: result.insertId, message: 'Product created' });

  } catch (err) {
    console.error('[productController.create]', err.message);
    serverError(res, err, '[productController.create]');
  }
};

/* ── PUT /api/products/:id  (admin only) ──────────────────── */
exports.update = async (req, res) => {
  // ── 1. Validate ID ────────────────────────────────────────────────────────
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) return sendError(res, 400, 'Invalid product ID');

  // ── 2. Validate required fields ───────────────────────────────────────────
  const { name, description, price, mrp, image, images, category, stock, unit, is_active } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return sendError(res, 400, 'Validation error: name is required');
  }
  if (price === undefined || price === null || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
    return sendError(res, 400, 'Validation error: price must be a positive number');
  }

  // ── 3. Validate image size before hitting the DB ───────────────────────────
  // base64 of an 8 MB raw file is ~10.7 M chars. Reject oversized payloads
  // with a clear 400 rather than letting MySQL throw a cryptic 500.
  // The body-parser limit (10 MB) is the outer guard; this is the inner one.
  const MAX_IMAGE_CHARS = 10_000_000; // ~7.5 MB raw file after base64 encoding
  if (image && typeof image === 'string' && image.length > MAX_IMAGE_CHARS) {
    return sendError(res, 400, `Image is too large (${(image.length / 1_000_000).toFixed(1)} MB). Maximum allowed is ~7.5 MB. Please compress the image and try again.`);
  }

  try {
    // ── 4. Check product exists ──────────────────────────────────────────────
    const [existing] = await db.query('SELECT id FROM products WHERE id = ?', [id]);
    if (!existing.length) return sendError(res, 404, 'Product not found');

    // ── 5. Detect which optional columns actually exist ──────────────────────
    // Builds the SET clause dynamically — never references columns absent from
    // the schema, which would throw ER_BAD_FIELD_ERROR → 500.
    // The cache is populated once per process and reset by ensureAuthTables
    // after any migration, so it always reflects the live schema.
    const cols = await _getProductCols();

    // ── 6. Serialise images array ────────────────────────────────────────────
    let imagesVal = null;
    if (cols.has('images') && images !== undefined) {
      try {
        const arr = Array.isArray(images) ? images : JSON.parse(images);
        imagesVal = JSON.stringify(arr);
      } catch { /* malformed JSON — store null */ }
    }

    // ── 7. Build SET clause via strict whitelist ─────────────────────────────
    // SECURITY: column names are NEVER derived from user input.
    // Only columns that (a) exist in the DB schema and (b) appear in this
    // whitelist can appear in the SET clause — no dynamic injection possible.
    const COLUMN_WHITELIST = {
      // column name → { clause, value }
      name:        { clause: 'name=?',        value: () => name.trim() },
      description: { clause: 'description=?', value: () => description || '' },
      price:       { clause: 'price=?',       value: () => parseFloat(price) },
      image:       { clause: 'image=?',        value: () => image || '' },
      category:    { clause: 'category=?',    value: () => category || 'General' },
      stock:       { clause: 'stock=?',        value: () => parseInt(stock, 10) >= 0 ? parseInt(stock, 10) : 0 },
      is_active:   { clause: 'is_active=?',   value: () => is_active !== undefined ? (is_active ? 1 : 0) : 1 },
      mrp:         { clause: 'mrp=?',          value: () => (mrp !== undefined && mrp !== null && !isNaN(parseFloat(mrp))) ? parseFloat(mrp) : null },
      images:      { clause: 'images=?',       value: () => imagesVal },
      unit:        { clause: 'unit=?',         value: () => unit || 'piece' },
    };

    // Always-included columns (guaranteed to exist in schema)
    const ALWAYS = ['name', 'description', 'price', 'image', 'category', 'stock', 'is_active'];
    // Optional columns — only included if the column exists in the live schema
    const OPTIONAL = ['mrp', 'images', 'unit'];

    const setClauses = [];
    const params     = [];

    for (const col of ALWAYS) {
      const entry = COLUMN_WHITELIST[col];
      setClauses.push(entry.clause);
      params.push(entry.value());
    }
    for (const col of OPTIONAL) {
      if (cols.has(col)) {
        const entry = COLUMN_WHITELIST[col];
        setClauses.push(entry.clause);
        params.push(entry.value());
      }
    }
    params.push(id); // WHERE id = ?

    // ── 8. Execute UPDATE ────────────────────────────────────────────────────
    const [result] = await db.query(
      `UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );
    console.info(`[productController.update] product ${id} updated (affectedRows: ${result.affectedRows})`);

    res.json({ success: true, message: 'Product updated' });

  } catch (err) {
    const ctx = `[productController.update] id=${id}`;
    console.error(`${ctx} — ${err.code || 'ERR'}: ${err.message}`);

    // ── ER_DATA_TOO_LONG ─────────────────────────────────────────────────────
    // This should never happen after the ensureAuthTables migration widens the
    // image column to LONGTEXT on startup (and server.js now blocks until that
    // migration finishes). If it still occurs (manual DB reset, permissions
    // issue), we attempt the ALTER inline and immediately retry the UPDATE once
    // — the user gets a 200 on the same request rather than a "try again" 500.
    if (err.code === 'ER_DATA_TOO_LONG') {
      console.warn(`${ctx} — ER_DATA_TOO_LONG: image column too small, attempting inline ALTER…`);
      try {
        await db.query('ALTER TABLE `products` MODIFY COLUMN `image` LONGTEXT NOT NULL');
        _cols = null; // force cache refresh
        console.info(`${ctx} — ✓ Upgraded products.image → LONGTEXT, retrying UPDATE…`);

        // Rebuild params (cols cache is now stale — re-fetch synchronously)
        const freshCols = await _getProductCols();
        // Retry uses same whitelist pattern — no dynamic column injection
        const RETRY_ALWAYS   = ['name','description','price','image','category','stock','is_active'];
        const RETRY_OPTIONAL = ['mrp','images','unit'];
        const RETRY_VALUES   = {
          name: name.trim(), description: description||'', price: parseFloat(price),
          image: image||'', category: category||'General',
          stock: parseInt(stock,10)>=0?parseInt(stock,10):0,
          is_active: is_active!==undefined?(is_active?1:0):1,
          mrp: (mrp!==undefined&&mrp!==null&&!isNaN(parseFloat(mrp)))?parseFloat(mrp):null,
          images: null, unit: unit||'piece',
        };
        const rSet = []; const rPrm = [];
        for (const col of RETRY_ALWAYS)   { rSet.push(col+'=?'); rPrm.push(RETRY_VALUES[col]); }
        for (const col of RETRY_OPTIONAL) { if (freshCols.has(col)) { rSet.push(col+'=?'); rPrm.push(RETRY_VALUES[col]); } }
        rPrm.push(id);
        await db.query(`UPDATE products SET ${rSet.join(', ')} WHERE id = ?`, rPrm);
        console.info(`${ctx} — ✓ Retry UPDATE succeeded after column upgrade`);
        return res.json({ success: true, message: 'Product updated' });
      } catch (retryErr) {
        console.error(`${ctx} — Retry after ALTER failed: ${retryErr.message}`);
        return sendError(res, 500, 'Image could not be saved. Please run: ALTER TABLE products MODIFY COLUMN image LONGTEXT NOT NULL; and try again.');
      }
    }

    // ── ER_BAD_FIELD_ERROR ───────────────────────────────────────────────────
    // A column in the dynamic SET clause doesn't exist in the schema.
    // Reset the cache so the next request re-queries INFORMATION_SCHEMA.
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      _cols = null;
      console.error(`${ctx} — ER_BAD_FIELD_ERROR: column cache reset. This request cannot be retried automatically.`);
    }

    serverError(res, err, ctx);
  }
};

/* ── Cache reset — called by ensureAuthTables after adding columns ──────── */
// Without this, _getProductCols() returns the pre-migration column set for
// the lifetime of the process, and the new mrp/unit/images columns are never
// included in UPDATE queries even after the DB schema is fixed.
exports.resetProductColsCache = function () {
  _cols = null;
};

/* ── DELETE /api/products/:id  (admin only, soft-delete) ──── */
exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return sendError(res, 400, 'Invalid product ID');

    await db.query('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
    res.json({ success: true, message: 'Product removed' });

  } catch (err) {
    console.error('[productController.remove]', err.message);
    serverError(res, err, '[productController.remove]');
  }
};