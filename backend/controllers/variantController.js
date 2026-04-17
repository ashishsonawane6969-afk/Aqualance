'use strict';

const db = require('../config/db');
const { serverError } = require('../utils/errors');

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

/* ── POST /api/v1/products/:id/variants ─────────────────────── */
exports.saveVariants = async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId) || productId <= 0) return sendError(res, 400, 'Invalid product ID');

  const { variants } = req.body;
  if (!Array.isArray(variants)) return sendError(res, 400, 'Variants must be an array');

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Deactivate current variants
    await connection.query(
      'UPDATE product_variants SET is_active = 0 WHERE product_id = ?',
      [productId]
    );

    // 2. Insert or update variants
    for (const v of variants) {
      const {
        variant_name, price, distributor_price, stock, bundle_enabled,
        size_value, size_unit, sku, id
      } = v;

      if (!variant_name || isNaN(parseFloat(price))) continue;

      const cols = [
        'product_id', 'variant_name', 'price', 'distributor_price', 'stock',
        'bundle_enabled', 'size_value', 'size_unit', 'sku', 'is_active'
      ];
      const vals = [
        productId, variant_name, parseFloat(price),
        distributor_price ? parseFloat(distributor_price) : null,
        parseInt(stock) || 0,
        bundle_enabled ? 1 : 0,
        parseFloat(size_value) || 0,
        size_unit || 'GM',
        sku || `P${productId}-V${Math.random().toString(36).substr(2, 5)}`,
        1
      ];

      if (id) {
        // Update existing
        const setClause = cols.map(c => `\`${c}\` = ?`).join(', ');
        await connection.query(
          `UPDATE product_variants SET ${setClause} WHERE id = ? AND product_id = ?`,
          [...vals, id, productId]
        );
      } else {
        // Insert new
        await connection.query(
          `INSERT INTO product_variants (${cols.map(c => `\`${c}\`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          vals
        );
      }
    }

    await connection.commit();
    res.json({ success: true, message: 'Variants saved' });
  } catch (err) {
    await connection.rollback();
    serverError(res, err, '[variantController.saveVariants]');
  } finally {
    connection.release();
  }
};

/* ── GET /api/v1/products/:id/variants ─────────────────────── */
exports.getByProduct = async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (isNaN(productId) || productId <= 0) return sendError(res, 400, 'Invalid product ID');

  try {
    const [rows] = await db.query(
      'SELECT * FROM product_variants WHERE product_id = ? AND is_active = 1 ORDER BY id',
      [productId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[variantController.getByProduct]');
  }
};
