'use strict';

const db              = require('../config/db');
const { serverError } = require('../utils/errors');
const path            = require('path');
const { saveBase64Image } = require('../utils/imageHandler');

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
    _cols = new Set(['id','name','description','price','image','image2','image3','category','stock','is_active','created_at']);
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
    _variantCols = new Set(['id','product_id','variant_name','price','distributor_price','stock','bundle_enabled','is_active']);
  }
  return _variantCols;
}

/* ── Image Validation & Handling ───────────────────────────── */
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

async function processImages(reqBody) {
  const uploadDir = path.join(__dirname, '..', 'uploads');
  const images = {};

  const imageFields = ['image', 'image2', 'image3'];
  for (const field of imageFields) {
    if (reqBody[field]) {
      if (reqBody[field].length > MAX_IMAGE_SIZE * 1.4) { // base64 overhead
        throw new Error(`${field} is too large. Max 5MB.`);
      }
      images[field] = await saveBase64Image(reqBody[field], uploadDir);
    } else {
      images[field] = '';
    }
  }
  return images;
}

/* ── GET /api/v1/products ──────────────────────────────────── */
exports.getAll = async (req, res) => {
  try {
    const { category, search } = req.query;
    const cols = await _getProductCols();

    const selectCols = [
      'id', 'name', 'description', 'price', 'category', 'stock', 'is_active', 'created_at',
      ...(cols.has('mrp')                ? ['mrp']                : []),
      ...(cols.has('distributor_price')  ? ['distributor_price']  : []),
      ...(cols.has('image')              ? ['image']              : []),
      ...(cols.has('image2')             ? ['image2']             : []),
      ...(cols.has('image3')             ? ['image3']             : []),
      ...(cols.has('unit')               ? ['unit']               : []),
      ...(cols.has('product_type')       ? ['product_type']       : []),
      ...(cols.has('is_bundle')          ? ['is_bundle']          : []),
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

    const product = rows[0];

    // Attach variants
    try {
      const [variants] = await db.query(
        `SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY id`,
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
    const processedImages = await processImages(req.body);
    const {
      name, description, price, mrp, distributor_price, category, stock, unit,
      product_type, is_bundle
    } = req.body;

    const cols = await _getProductCols();

    const insertCols = ['name', 'description', 'price', 'category', 'stock'];
    const insertVals = [
      name.trim(), description || '', parseFloat(price),
      category || 'General', parseInt(stock) || 0,
    ];

    const optional = {
      mrp:               () => mrp ? parseFloat(mrp) : null,
      distributor_price: () => distributor_price != null && !isNaN(parseFloat(distributor_price)) ? parseFloat(distributor_price) : null,
      image:             () => processedImages.image,
      image2:            () => processedImages.image2,
      image3:            () => processedImages.image3,
      unit:              () => unit || 'piece',
      product_type:      () => product_type || 'single',
      is_bundle:         () => is_bundle ? 1 : 0,
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
    if (err.message.includes('too large')) return sendError(res, 400, err.message);
    serverError(res, err, '[productController.create]');
  }
};

/* ── PUT /api/v1/products/:id ──────────────────────────────── */
exports.update = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id <= 0) return sendError(res, 400, 'Invalid product ID');

  try {
    const processedImages = await processImages(req.body);
    const {
      name, description, price, mrp, distributor_price, category, stock, unit, is_active,
      product_type, is_bundle
    } = req.body;

    if (!name || !name.trim()) return sendError(res, 400, 'name is required');
    if (!price || parseFloat(price) <= 0) return sendError(res, 400, 'price must be positive');

    const [existing] = await db.query('SELECT id FROM products WHERE id = ?', [id]);
    if (!existing.length) return sendError(res, 404, 'Product not found');

    const cols = await _getProductCols();

    const WHITELIST = {
      name:              { c: 'name=?',              v: () => name.trim() },
      description:       { c: 'description=?',       v: () => description || '' },
      price:             { c: 'price=?',             v: () => parseFloat(price) },
      category:          { c: 'category=?',          v: () => category || 'General' },
      stock:             { c: 'stock=?',             v: () => Math.max(0, parseInt(stock, 10) || 0) },
      is_active:         { c: 'is_active=?',         v: () => is_active !== undefined ? (is_active ? 1 : 0) : 1 },
      mrp:               { c: 'mrp=?',               v: () => mrp != null && !isNaN(parseFloat(mrp)) ? parseFloat(mrp) : null },
      distributor_price: { c: 'distributor_price=?', v: () => distributor_price != null && !isNaN(parseFloat(distributor_price)) ? parseFloat(distributor_price) : null },
      image:             { c: 'image=?',             v: () => processedImages.image },
      image2:            { c: 'image2=?',            v: () => processedImages.image2 },
      image3:            { c: 'image3=?',            v: () => processedImages.image3 },
      unit:              { c: 'unit=?',              v: () => unit || 'piece' },
      product_type:      { c: 'product_type=?',      v: () => product_type || 'single' },
      is_bundle:         { c: 'is_bundle=?',         v: () => is_bundle !== undefined ? (is_bundle ? 1 : 0) : undefined },
    };

    const ALWAYS   = ['name','description','price','category','stock','is_active'];
    const OPTIONAL = ['mrp','distributor_price','image','image2','image3','unit','product_type','is_bundle'];

    const setClauses = [];
    const params     = [];

    for (const col of ALWAYS) {
      setClauses.push(WHITELIST[col].c);
      params.push(WHITELIST[col].v());
    }
    for (const col of OPTIONAL) {
      if (cols.has(col)) {
        const val = WHITELIST[col].v();
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
    if (err.message.includes('too large')) return sendError(res, 400, err.message);
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
