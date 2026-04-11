'use strict';

const db = require('../config/db');
const { serverError } = require('../utils/errors');

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

function generateSKU(productId, index) {
  const ts = Date.now().toString(36).toUpperCase();
  return `SKU-${productId}-${index}-${ts}`;
}

/* GET /api/v1/products/:id/variants */
exports.list = async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (!productId) return sendError(res, 400, 'Invalid product ID');

    let rows;
    try {
      [rows] = await db.query(
        'SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY sort_order, id',
        [productId]
      );
    } catch (e) {
      // sort_order column may not exist on older deployments — fall back safely
      if (e.code === 'ER_BAD_FIELD_ERROR') {
        [rows] = await db.query(
          'SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY id',
          [productId]
        );
      } else { throw e; }
    }
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[variantController.list]');
  }
};

/* POST /api/v1/products/:id/variants — bulk upsert (replaces all) */
exports.bulkUpsert = async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (!productId) return sendError(res, 400, 'Invalid product ID');

  const { variants } = req.body;
  if (!Array.isArray(variants)) return sendError(res, 400, 'variants must be an array');
  if (variants.length > 20) return sendError(res, 400, 'Maximum 20 variants per product');

  const [prod] = await db.query('SELECT id FROM products WHERE id = ?', [productId]);
  if (!prod.length) return sendError(res, 404, 'Product not found');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Soft-delete existing
    await conn.query(
      'UPDATE product_variants SET is_active = 0 WHERE product_id = ?',
      [productId]
    );

    const inserted = [];
    for (let i = 0; i < variants.length; i++) {
      const v   = variants[i];
      const sku = (v.sku && v.sku.trim()) || generateSKU(productId, i + 1);

      if (!v.variant_name || !v.variant_name.trim()) {
        throw new Error(`Variant ${i + 1}: variant_name is required`);
      }
      if (!v.size_unit || !['GM', 'ML', 'KG', 'L', 'PCS'].includes(v.size_unit)) {
        throw new Error(`Variant ${i + 1}: size_unit must be GM, ML, KG, L, or PCS`);
      }
      if (!v.price || parseFloat(v.price) <= 0) {
        throw new Error(`Variant ${i + 1}: price must be positive`);
      }

      let result;
      try {
        [result] = await conn.query(
          `INSERT INTO product_variants
            (product_id, variant_name, size_value, size_unit, pack_quantity, price, mrp, stock, sku, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE
            variant_name=VALUES(variant_name), size_value=VALUES(size_value),
            size_unit=VALUES(size_unit), pack_quantity=VALUES(pack_quantity),
            price=VALUES(price), mrp=VALUES(mrp), stock=VALUES(stock),
            sort_order=VALUES(sort_order), is_active=1`,
          [
            productId,
            v.variant_name.trim(),
            parseFloat(v.size_value) || 0,
            v.size_unit,
            parseInt(v.pack_quantity, 10) || 1,
            parseFloat(v.price),
            v.mrp ? parseFloat(v.mrp) : null,
            parseInt(v.stock, 10) || 0,
            sku,
            i,
          ]
        );
      } catch (colErr) {
        // Fallback for deployments missing pack_quantity or sort_order columns
        if (colErr.code === 'ER_BAD_FIELD_ERROR') {
          [result] = await conn.query(
            `INSERT INTO product_variants
              (product_id, variant_name, size_value, size_unit, price, mrp, stock, sku, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
              variant_name=VALUES(variant_name), size_value=VALUES(size_value),
              size_unit=VALUES(size_unit), price=VALUES(price),
              mrp=VALUES(mrp), stock=VALUES(stock), is_active=1`,
            [
              productId,
              v.variant_name.trim(),
              parseFloat(v.size_value) || 0,
              v.size_unit,
              parseFloat(v.price),
              v.mrp ? parseFloat(v.mrp) : null,
              parseInt(v.stock, 10) || 0,
              sku,
            ]
          );
        } else { throw colErr; }
      }
      inserted.push({ id: result.insertId || v.id, sku });
    }

    await conn.commit();
    res.json({ success: true, message: 'Variants saved', data: inserted });
  } catch (err) {
    await conn.rollback();
    if (err.message && err.message.startsWith('Variant ')) {
      return sendError(res, 400, err.message);
    }
    serverError(res, err, '[variantController.bulkUpsert]');
  } finally {
    conn.release();
  }
};

/* DELETE /api/v1/products/:id/variants/:variantId */
exports.remove = async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const variantId = parseInt(req.params.variantId, 10);
    if (!productId || !variantId) return sendError(res, 400, 'Invalid ID');

    await db.query(
      'UPDATE product_variants SET is_active = 0 WHERE id = ? AND product_id = ?',
      [variantId, productId]
    );
    res.json({ success: true, message: 'Variant removed' });
  } catch (err) {
    serverError(res, err, '[variantController.remove]');
  }
};
