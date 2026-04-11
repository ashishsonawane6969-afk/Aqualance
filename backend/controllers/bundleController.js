'use strict';

const db = require('../config/db');
const { serverError } = require('../utils/errors');

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

/* GET /api/v1/products/:id/bundle-items */
exports.list = async (req, res) => {
  try {
    const bundleId = parseInt(req.params.id, 10);
    if (!bundleId) return sendError(res, 400, 'Invalid product ID');

    const [rows] = await db.query(
      `SELECT bi.id, bi.product_id, bi.variant_id, bi.quantity,
              p.name AS product_name, p.price AS product_price,
              pv.variant_name, pv.price AS variant_price, pv.size_value, pv.size_unit, pv.sku
       FROM bundle_items bi
       JOIN products p ON p.id = bi.product_id
       LEFT JOIN product_variants pv ON pv.id = bi.variant_id AND pv.is_active = 1
       WHERE bi.bundle_product_id = ?
       ORDER BY bi.id`,
      [bundleId]
    );
    res.json({ success: true, data: rows });
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
  if (items.length > 50) return sendError(res, 400, 'Maximum 50 bundle items');

  const [prod] = await db.query(
    'SELECT id, is_bundle FROM products WHERE id = ? AND is_active = 1',
    [bundleId]
  );
  if (!prod.length) return sendError(res, 404, 'Product not found');
  if (!prod[0].is_bundle) return sendError(res, 400, 'Product is not a bundle');

  const conn = await db.getConnection();
  try {
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
    res.json({ success: true, message: 'Bundle items saved', count: items.length });
  } catch (err) {
    await conn.rollback();
    if (err.message && (err.message.startsWith('Item ') || err.message.includes('bundle cannot'))) {
      return sendError(res, 400, err.message);
    }
    serverError(res, err, '[bundleController.bulkSave]');
  } finally {
    conn.release();
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
