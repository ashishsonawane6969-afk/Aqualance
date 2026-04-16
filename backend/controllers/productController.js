'use strict';

const db              = require('../config/db');
const { serverError } = require('../utils/errors');

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

let _cols         = null;
let _variantCols  = null;

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

async function _getVariantCols() {
  if (_variantCols) return _variantCols;
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants'`
    );
    _variantCols = new Set(rows.map(r => r.COLUMN_NAME));
  } catch (e) {
    _variantCols = new Set(['id','product_id','variant_name','price','size_value','size_unit','sku','is_active']);
  }
  return _variantCols;
}

/* ── Auto-migrate: add distributor_price column if missing ───────────────── */
async function _ensureDistributorPriceCol() {
  try {
    const cols = await _getProductCols();
    if (!cols.has('distributor_price')) {
      await db.query(
        `ALTER TABLE products ADD COLUMN distributor_price DECIMAL(10,2) NULL DEFAULT NULL`
      );
      _cols = null; // bust cache so next call re-reads the real columns
      console.log('[productController] distributor_price column added via auto-migration');
    }
  } catch (e) {
    // Column may already exist in a concurrent request — safe to ignore
    if (e.code !== 'ER_DUP_FIELDNAME') {
      console.error('[productController] distributor_price migration error:', e.message);
    }
  }
}

// Run once at startup — non-blocking
_ensureDistributorPriceCol();

function _parseImages(raw) {
  if (!raw) return [];
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw);
    return arr.filter(Boolean).slice(0, 3);
  } catch { return []; }
}

async function _attachVariantCounts(ids) {
  if (!ids.length) return {};
  try {
    const [rows] = await db.query(
      `SELECT product_id, COUNT(*) AS cnt FROM product_variants
       WHERE product_id IN (${ids.map(() => '?').join(',')}) AND is_active = 1
       GROUP BY product_id`,
      ids
    );
    const map = {};
    rows.forEach(r => { map[r.product_id] = r.cnt; });
    return map;
  } catch { return {}; }
}

/* ── GET /api/v1/products ──────────────────────────────────── */
exports.getAll = async (req, res) => {
  try {
    const { category, search } = req.query;
    const cols = await _getProductCols();

    const selectCols = [
      'id', 'name', 'description', 'price', 'category', 'stock', 'is_active', 'created_at',
      ...(cols.has('mrp')                ? ['mrp']                : []),
      ...(cols.has('distributor_price')  ? ['distributor_price']  : []),  // ← FIX
      ...(cols.has('image')              ? ['image']              : []),
      ...(cols.has('images')             ? ['images']             : []),
      ...(cols.has('unit')               ? ['unit']               : []),
      ...(cols.has('product_type')       ? ['product_type']       : []),
      ...(cols.has('base_quantity')      ? ['base_quantity']      : []),
      ...(cols.has('base_unit')          ? ['base_unit']          : []),
      ...(cols.has('pack_size')          ? ['pack_size']          : []),
      ...(cols.has('is_bundle')          ? ['is_bundle']          : []),
      ...(cols.has('display_name')       ? ['display_name']       : []),
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

    const ids        = rows.map(r => r.id);
    const variantMap = await _attachVariantCounts(ids);

    rows.forEach(r => {
      r.images        = _parseImages(r.images);
      r.is_bundle     = Boolean(r.is_bundle);
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
    if (isNaN(id) || id <= 0) return sendError(res, 400, 'Invalid product ID');

    const [rows] = await db.query(
      'SELECT * FROM products WHERE id = ? AND is_active = 1',
      [id]
    );
    if (!rows.length) return sendError(res, 404, 'Product not found');

    const product      = rows[0];
    product.images     = _parseImages(product.images);
    product.is_bundle  = Boolean(product.is_bundle);

    // Attach variants
    try {
      const vCols     = await _getVariantCols();
      const orderBy   = vCols.has('sort_order') ? 'ORDER BY sort_order, id' : 'ORDER BY id';
      const [variants] = await db.query(
        `SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ${orderBy}`,
        [id]
      );
      product.variants = variants;
    } catch { product.variants = []; }

    // Attach bundle items
    if (product.is_bundle) {
      try {
        const [bundleItems] = await db.query(
          `SELECT bi.id, bi.product_id, bi.variant_id, bi.quantity,
                  COALESCE(p.name, '')          AS product_name,
                  COALESCE(p.price, 0)          AS product_price,
                  COALESCE(pv.variant_name, '') AS variant_name,
                  COALESCE(pv.price, 0)         AS variant_price,
                  COALESCE(pv.size_value, '')   AS size_value,
                  COALESCE(pv.size_unit, '')    AS size_unit,
                  COALESCE(pv.sku, '')          AS sku,
                  CASE WHEN bi.variant_id IS NOT NULL AND pv.id IS NOT NULL THEN 1 ELSE 0 END AS has_variant
           FROM bundle_items bi
           LEFT JOIN products p ON p.id = bi.product_id
           LEFT JOIN product_variants pv ON pv.id = bi.variant_id AND pv.is_active = 1
           WHERE bi.bundle_product_id = ?
           ORDER BY bi.id`,
          [id]
        );
        product.bundle_items = bundleItems;

        if (bundleItems.length > 0) {
          let calc = 0;
          bundleItems.forEach(item => {
            calc += (item.variant_price != null
              ? parseFloat(item.variant_price)
              : parseFloat(item.product_price)
            ) * item.quantity;
          });
          product.bundle_calculated_price = parseFloat(calc.toFixed(2));
        }
      } catch { product.bundle_items = []; }
    } else {
      product.bundle_items = [];
    }

    res.json({ success: true, data: product });
  } catch (err) {
    serverError(res, err, '[productController.getOne]');
  }
};

/* ── POST /api/v1/products ─────────────────────────────────── */
exports.create = async (req, res) => {
  try {
    const {
      name, description, price, mrp, distributor_price, image, images, category, stock, unit,
      product_type, base_quantity, base_unit, pack_size, is_bundle, display_name,
    } = req.body;

    const cols = await _getProductCols();

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
      mrp:               () => mrp ? parseFloat(mrp) : null,
      distributor_price: () => distributor_price != null && !isNaN(parseFloat(distributor_price)) ? parseFloat(distributor_price) : null,
      images:            () => imagesVal,
      unit:              () => unit || 'piece',
      product_type:      () => ['jar', 'strip', 'single'].includes(product_type) ? product_type : 'single',
      base_quantity:     () => base_quantity != null ? parseFloat(base_quantity) : null,
      base_unit:         () => base_unit || null,
      pack_size:         () => pack_size != null ? parseInt(pack_size, 10) : null,
      is_bundle:         () => is_bundle ? 1 : 0,
      display_name:      () => display_name || null,
    };

    for (const [col, fn] of Object.entries(optional)) {
      if (cols.has(col)) { insertCols.push(col); insertVals.push(fn()); }
    }

    const [result] = await db.query(
      `INSERT INTO products (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
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
  if (isNaN(id) || id <= 0) return sendError(res, 400, 'Invalid product ID');

  const {
    name, description, price, mrp, distributor_price, image, images, category, stock, unit, is_active,
    product_type, base_quantity, base_unit, pack_size, is_bundle, display_name,
  } = req.body;

  if (!name || !name.trim()) return sendError(res, 400, 'name is required');
  if (!price || parseFloat(price) <= 0) return sendError(res, 400, 'price must be positive');

  const MAX_IMAGE_CHARS = 10_000_000;
  if (image && typeof image === 'string' && image.length > MAX_IMAGE_CHARS) {
    return sendError(res, 400, 'Image too large. Maximum ~7.5 MB. Please compress and try again.');
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
      mrp:               { c: 'mrp=?',               v: () => mrp != null && !isNaN(parseFloat(mrp)) ? parseFloat(mrp) : null },
      distributor_price: { c: 'distributor_price=?',  v: () => distributor_price != null && !isNaN(parseFloat(distributor_price)) ? parseFloat(distributor_price) : null },
      images:            { c: 'images=?',             v: () => imagesVal },
      unit:              { c: 'unit=?',               v: () => unit || 'piece' },
      product_type:      { c: 'product_type=?',       v: () => ['jar','strip','single'].includes(product_type) ? product_type : 'single' },
      base_quantity:     { c: 'base_quantity=?',      v: () => base_quantity != null ? parseFloat(base_quantity) : null },
      base_unit:         { c: 'base_unit=?',          v: () => base_unit || null },
      pack_size:         { c: 'pack_size=?',          v: () => pack_size != null ? parseInt(pack_size, 10) : null },
      is_bundle:         { c: 'is_bundle=?',          v: () => is_bundle !== undefined ? (is_bundle ? 1 : 0) : undefined },
      display_name:      { c: 'display_name=?',       v: () => display_name !== undefined ? (display_name || null) : undefined },
    };

    const ALWAYS   = ['name','description','price','image','category','stock','is_active'];
    const OPTIONAL = ['mrp','distributor_price','images','unit','product_type','base_quantity','base_unit','pack_size','is_bundle','display_name'];

    const setClauses = [];
    const params     = [];

    for (const col of ALWAYS) {
      setClauses.push(WHITELIST[col].c);
      params.push(WHITELIST[col].v());
    }
    for (const col of OPTIONAL) {
      if (cols.has(col)) {
        const val = WHITELIST[col].v();
        // Skip undefined values — don't overwrite DB with undefined when field wasn't sent
        if (val !== undefined) {
          setClauses.push(WHITELIST[col].c);
          params.push(val);
        }
      }
    }
    params.push(id);

    await db.query(`UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`, params);
    res.json({ success: true, message: 'Product updated' });
  } catch (err) {
    if (err.code === 'ER_DATA_TOO_LONG') {
      try {
        await db.query('ALTER TABLE `products` MODIFY COLUMN `image` LONGTEXT NOT NULL');
        _cols = null;
      } catch (_) {}
      return sendError(res, 400, 'Image too large for current DB column. Column upgrade attempted — please retry.');
    }
    if (err.code === 'ER_BAD_FIELD_ERROR') _cols = null;
    serverError(res, err, `[productController.update] id=${id}`);
  }
};

exports.resetProductColsCache = function () { _cols = null; _variantCols = null; };

/* ── DELETE /api/v1/products/:id ───────────────────────────── */
exports.remove = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id <= 0) return sendError(res, 400, 'Invalid product ID');
    await db.query('UPDATE products SET is_active = 0 WHERE id = ?', [id]);
    res.json({ success: true, message: 'Product removed' });
  } catch (err) {
    serverError(res, err, '[productController.remove]');
  }
};
