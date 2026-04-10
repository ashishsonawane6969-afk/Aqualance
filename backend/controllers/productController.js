'use strict';

const db              = require('../config/db');
const { serverError } = require('../utils/errors');

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

let _cols = null;

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

function _parseImages(raw) {
  if (!raw) return [];
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
    return arr.filter(Boolean).slice(0, 3);
  } catch { return []; }
}

/* ── GET /api/v1/products ──────────────────────────────────── */
exports.getAll = async (req, res) => {
  try {
    const { category, search } = req.query;
    const cols = await _getProductCols();

    const selectCols = [
      'id', 'name', 'description', 'price', 'category', 'stock', 'is_active', 'created_at',
      ...(cols.has('mrp')           ? ['mrp']           : []),
      ...(cols.has('image')         ? ['image']         : []),
      ...(cols.has('images')        ? ['images']        : []),
      ...(cols.has('unit')          ? ['unit']          : []),
      ...(cols.has('base_quantity') ? ['base_quantity'] : []),
      ...(cols.has('base_unit')     ? ['base_unit']     : []),
      ...(cols.has('pack_size')     ? ['pack_size']     : []),
      ...(cols.has('is_bundle')     ? ['is_bundle']     : []),
      ...(cols.has('display_name')  ? ['display_name']  : []),
      ...(cols.has('product_type')  ? ['product_type']  : []),
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

    // Attach variants count for listing
    const ids = rows.map(r => r.id);
    let variantMap = {};
    if (ids.length > 0) {
      try {
        const [vrows] = await db.query(
          `SELECT product_id, COUNT(*) AS cnt FROM product_variants
           WHERE product_id IN (${ids.map(() => '?').join(',')}) AND is_active = 1
           GROUP BY product_id`,
          ids
        );
        vrows.forEach(v => { variantMap[v.product_id] = v.cnt; });
      } catch { /* variants table may not exist yet */ }
    }

    rows.forEach(r => {
      r.images      = _parseImages(r.images);
      r.is_bundle   = Boolean(r.is_bundle);
      r.variant_count = variantMap[r.id] || 0;
    });

    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    serverError(res, err, '[productController.getAll]');
  }
};

/* ── GET /api/v1/products/:id ──────────────────────────────── */
exports.getOne = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return sendError(res, 400, 'Invalid product ID');

    const [rows] = await db.query(
      'SELECT * FROM products WHERE id = ? AND is_active = 1',
      [id]
    );
    if (!rows.length) return sendError(res, 404, 'Product not found');

    const product = rows[0];
    product.images    = _parseImages(product.images);
    product.is_bundle = Boolean(product.is_bundle);

    // Attach variants
    try {
      const [variants] = await db.query(
        'SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order, id',
        [id]
      );
      product.variants = variants;
    } catch { product.variants = []; }

    res.json({ success: true, data: product });
  } catch (err) {
    serverError(res, err, '[productController.getOne]');
  }
};

/* ── POST /api/v1/products ─────────────────────────────────── */
exports.create = async (req, res) => {
  try {
    const {
      name, description, price, mrp, image, images, category, stock, unit,
      base_quantity, base_unit, pack_size, is_bundle, display_name, product_type,
    } = req.body;

    const cols = await _getProductCols();

    // Validate + serialize images (max 3)
    let imagesVal = null;
    if (images) {
      const arr = Array.isArray(images) ? images : JSON.parse(images);
      if (arr.length > 3) return sendError(res, 400, 'Maximum 3 images allowed');
      imagesVal = JSON.stringify(arr.filter(Boolean).slice(0, 3));
    }

    const insertCols = ['name', 'description', 'price', 'image', 'category', 'stock'];
    const insertVals = [
      name.trim(), description || '', parseFloat(price),
      image || '', category || 'General', parseInt(stock) || 0,
    ];

    const optional = {
      mrp:           () => mrp ? parseFloat(mrp) : null,
      images:        () => imagesVal,
      unit:          () => unit || 'piece',
      base_quantity: () => base_quantity != null ? parseFloat(base_quantity) : null,
      base_unit:     () => base_unit || null,
      pack_size:     () => pack_size != null ? parseInt(pack_size, 10) : null,
      is_bundle:     () => is_bundle ? 1 : 0,
      display_name:  () => display_name || null,
      product_type:  () => ['jar', 'strip', 'single'].includes(product_type) ? product_type : 'single',
    };

    for (const [col, fn] of Object.entries(optional)) {
      if (cols.has(col)) { insertCols.push(col); insertVals.push(fn()); }
    }

    const placeholders = insertCols.map(() => '?').join(', ');
    const [result] = await db.query(
      `INSERT INTO products (${insertCols.join(', ')}) VALUES (${placeholders})`,
      insertVals
    );

    res.status(201).json({ success: true, id: result.insertId, message: 'Product created' });
  } catch (err) {
    serverError(res, err, '[productController.create]');
  }
};

/* ── PUT /api/v1/products/:id ──────────────────────────────── */
exports.update = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return sendError(res, 400, 'Invalid product ID');

  const {
    name, description, price, mrp, image, images, category, stock, unit, is_active,
    base_quantity, base_unit, pack_size, is_bundle, display_name, product_type,
  } = req.body;

  if (!name || !name.trim()) return sendError(res, 400, 'name is required');
  if (!price || parseFloat(price) <= 0) return sendError(res, 400, 'price must be positive');

  const MAX_IMAGE_CHARS = 10_000_000;
  if (image && typeof image === 'string' && image.length > MAX_IMAGE_CHARS) {
    return sendError(res, 400, 'Image too large. Maximum ~7.5 MB.');
  }

  try {
    const [existing] = await db.query('SELECT id FROM products WHERE id = ?', [id]);
    if (!existing.length) return sendError(res, 404, 'Product not found');

    const cols = await _getProductCols();

    let imagesVal = null;
    if (cols.has('images') && images !== undefined) {
      const arr = Array.isArray(images) ? images : JSON.parse(images || '[]');
      if (arr.length > 3) return sendError(res, 400, 'Maximum 3 images allowed');
      imagesVal = JSON.stringify(arr.filter(Boolean).slice(0, 3));
    }

    const WHITELIST = {
      name:          { c: 'name=?',          v: () => name.trim() },
      description:   { c: 'description=?',   v: () => description || '' },
      price:         { c: 'price=?',         v: () => parseFloat(price) },
      image:         { c: 'image=?',         v: () => image || '' },
      category:      { c: 'category=?',      v: () => category || 'General' },
      stock:         { c: 'stock=?',         v: () => Math.max(0, parseInt(stock, 10) || 0) },
      is_active:     { c: 'is_active=?',     v: () => is_active !== undefined ? (is_active ? 1 : 0) : 1 },
      mrp:           { c: 'mrp=?',           v: () => mrp != null && !isNaN(parseFloat(mrp)) ? parseFloat(mrp) : null },
      images:        { c: 'images=?',        v: () => imagesVal },
      unit:          { c: 'unit=?',          v: () => unit || 'piece' },
      base_quantity: { c: 'base_quantity=?', v: () => base_quantity != null ? parseFloat(base_quantity) : null },
      base_unit:     { c: 'base_unit=?',     v: () => base_unit || null },
      pack_size:     { c: 'pack_size=?',     v: () => pack_size != null ? parseInt(pack_size, 10) : null },
      is_bundle:     { c: 'is_bundle=?',     v: () => is_bundle ? 1 : 0 },
      display_name:  { c: 'display_name=?',  v: () => display_name || null },
      product_type:  { c: 'product_type=?',  v: () => ['jar','strip','single'].includes(product_type) ? product_type : 'single' },
    };

    const ALWAYS   = ['name','description','price','image','category','stock','is_active'];
    const OPTIONAL = ['mrp','images','unit','base_quantity','base_unit','pack_size','is_bundle','display_name','product_type'];

    const setClauses = [];
    const params     = [];

    for (const col of ALWAYS) {
      setClauses.push(WHITELIST[col].c);
      params.push(WHITELIST[col].v());
    }
    for (const col of OPTIONAL) {
      if (cols.has(col)) {
        setClauses.push(WHITELIST[col].c);
        params.push(WHITELIST[col].v());
      }
    }
    params.push(id);

    await db.query(`UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`, params);
    res.json({ success: true, message: 'Product updated' });
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') _cols = null;
    serverError(res, err, `[productController.update] id=${id}`);
  }
};

exports.resetProductColsCache = function () { _cols = null; };

/* ── DELETE /api/v1/products/:id ───────────────────────────── */
exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return sendError(res, 400, 'Invalid product ID');
    await db.query('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
    res.json({ success: true, message: 'Product removed' });
  } catch (err) {
    serverError(res, err, '[productController.remove]');
  }
};
