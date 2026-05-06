'use strict';

const db = require('../config/db');
const { serverError } = require('../utils/errors');

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

/* ── Helper: calculate bundle total from items array ─────── */
function _calcBundlePrice(items) {
  if (!items || !items.length) return 0;
  let total = 0;
  items.forEach(item => {
    const unitPrice = item.has_variant
      ? Number(item.variant_price || 0)
      : Number(item.product_price || 0);
    total += unitPrice * (item.quantity || 1);
  });
  return parseFloat(total.toFixed(2));
}

/* GET /api/v1/products/:id/bundle-items */
exports.list = async (req, res) => {
  const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
  const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page, 10) || 20));
  const offset  = (page - 1) * perPage;
  try {
    const bundleId = parseInt(req.params.id, 10);
    if (!bundleId) return sendError(res, 400, 'Invalid product ID');

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM bundle_items WHERE bundle_product_id = ?',
      [bundleId]
    );
    const [rows] = await db.query(
      `SELECT
         bi.id,
         bi.product_id,
         bi.variant_id,
         bi.quantity,
         COALESCE(p.name, '')           AS product_name,
         COALESCE(p.price, 0)           AS product_price,
         COALESCE(pv.variant_name, '')  AS variant_name,
         COALESCE(pv.price, 0)          AS variant_price,
         COALESCE(pv.size_value, '')    AS size_value,
         COALESCE(pv.size_unit, '')     AS size_unit,
         COALESCE(pv.sku, '')           AS sku,
         CASE WHEN bi.variant_id IS NOT NULL AND pv.id IS NOT NULL THEN 1 ELSE 0 END AS has_variant
       FROM bundle_items bi
       LEFT JOIN products p ON p.id = bi.product_id
       LEFT JOIN product_variants pv
         ON pv.id = bi.variant_id
         AND pv.is_active = 1
       WHERE bi.bundle_product_id = ?
       ORDER BY bi.id LIMIT ? OFFSET ?`,
      [bundleId, perPage, offset]
    );

    const data = rows.map(row => ({
      id:            row.id,
      product_id:    row.product_id,
      variant_id:    row.variant_id ?? null,
      quantity:      row.quantity,
      product_name:  row.product_name,
      product_price: Number(row.product_price),
      variant_name:  row.variant_name  || null,
      variant_price: row.has_variant   ? Number(row.variant_price) : null,
      size_value:    row.size_value    || null,
      size_unit:     row.size_unit     || null,
      sku:           row.sku           || null,
      has_variant:   Boolean(row.has_variant),
    }));

    const bundle_calculated_price = _calcBundlePrice(data);

    res.json({ success: true, data, bundle_calculated_price, pagination: { total, page, per_page: perPage } });
  } catch (err) {
    serverError(res, err, '[bundleController.list]');
  }
};

/* POST /api/v1/products/:id/bundle-items — bulk replace */
exports.bulkSave = async (req, res) => {
  const bundleId = parseInt(req.params.id, 10);
  if (!bundleId) return sendError(res, 400, 'Invalid product ID');

  const { items } = req.body;
  if (!Array.isArray(items)) return sendError(res, 400, 'items must be an array');
  if (items.length > 50)     return sendError(res, 400, 'Maximum 50 bundle items');

  let conn;
  try {
    const [prod] = await db.query(
      'SELECT id, is_bundle FROM products WHERE id = ? AND is_active = 1',
      [bundleId]
    );
    if (!prod.length)       return sendError(res, 404, 'Product not found');
    if (!prod[0].is_bundle) return sendError(res, 400, 'Product is not a bundle');

    conn = await db.getConnection();
    await conn.beginTransaction();

    await conn.query('DELETE FROM bundle_items WHERE bundle_product_id = ?', [bundleId]);

    for (let i = 0; i < items.length; i++) {
      const item      = items[i];
      const productId = parseInt(item.product_id, 10);
      const variantId = item.variant_id ? parseInt(item.variant_id, 10) : null;
      const quantity  = parseInt(item.quantity, 10) || 1;

      if (!productId || productId <= 0) throw new Error(`Item ${i + 1}: product_id is required`);
      if (productId === bundleId)       throw new Error(`Item ${i + 1}: bundle cannot contain itself`);
      if (quantity < 1)                 throw new Error(`Item ${i + 1}: quantity must be at least 1`);

      const [p] = await conn.query(
        'SELECT id FROM products WHERE id = ? AND is_active = 1', [productId]
      );
      if (!p.length) throw new Error(`Item ${i + 1}: product ID ${productId} not found`);

      if (variantId) {
        const [v] = await conn.query(
          'SELECT id FROM product_variants WHERE id = ? AND product_id = ? AND is_active = 1',
          [variantId, productId]
        );
        if (!v.length) throw new Error(`Item ${i + 1}: variant not found for product ${productId}`);
      }

      await conn.query(
        'INSERT INTO bundle_items (bundle_product_id, product_id, variant_id, quantity) VALUES (?, ?, ?, ?)',
        [bundleId, productId, variantId, quantity]
      );
    }

    await conn.commit();

    // FIX: Re-fetch saved items with pricing to return bundle_calculated_price
    const [savedRows] = await db.query(
      `SELECT
         bi.quantity,
         COALESCE(p.price, 0)  AS product_price,
         COALESCE(pv.price, 0) AS variant_price,
         CASE WHEN bi.variant_id IS NOT NULL AND pv.id IS NOT NULL THEN 1 ELSE 0 END AS has_variant
       FROM bundle_items bi
       LEFT JOIN products p ON p.id = bi.product_id
       LEFT JOIN product_variants pv ON pv.id = bi.variant_id AND pv.is_active = 1
       WHERE bi.bundle_product_id = ?`,
      [bundleId]
    );

    const bundle_calculated_price = _calcBundlePrice(
      savedRows.map(r => ({
        quantity:      r.quantity,
        product_price: Number(r.product_price),
        variant_price: Number(r.variant_price),
        has_variant:   Boolean(r.has_variant),
      }))
    );

    res.json({
      success: true,
      message: 'Bundle items saved',
      count: items.length,
      bundle_calculated_price,
    });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (_) {}
    }
    if (err.message && (err.message.startsWith('Item ') || err.message.includes('bundle cannot'))) {
      return sendError(res, 400, err.message);
    }
    serverError(res, err, '[bundleController.bulkSave]');
  } finally {
    if (conn) {
      try { conn.release(); } catch (_) {}
    }
  }
};

/* DELETE /api/v1/products/:id/bundle-items/:itemId */
exports.removeItem = async (req, res) => {
  try {
    const bundleId = parseInt(req.params.id, 10);
    const itemId   = parseInt(req.params.itemId, 10);
    if (!bundleId || !itemId) return sendError(res, 400, 'Invalid ID');

    await db.query(
      'DELETE FROM bundle_items WHERE id = ? AND bundle_product_id = ?',
      [itemId, bundleId]
    );
    res.json({ success: true, message: 'Bundle item removed' });
  } catch (err) {
    serverError(res, err, '[bundleController.removeItem]');
  }
};
