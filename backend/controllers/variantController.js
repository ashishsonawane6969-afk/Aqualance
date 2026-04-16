'use strict';

const db = require('../config/db');
const { serverError } = require('../utils/errors');

let _cols = null;

async function _getCols() {
  if (_cols) return _cols;
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_variants'`
    );
    _cols = new Set(rows.map(r => r.COLUMN_NAME));
  } catch {
    _cols = new Set(['id','product_id','variant_name','price','size_value','size_unit','stock','sku','is_active']);
  }
  return _cols;
}

async function _ensureCols() {
  const migrations = [
    { col: 'distributor_price', ddl: 'DECIMAL(10,2) NULL DEFAULT NULL' },
    { col: 'is_bundle',         ddl: 'TINYINT(1) NOT NULL DEFAULT 0' },
    { col: 'base_quantity',     ddl: 'DECIMAL(10,2) NULL DEFAULT NULL' },
    { col: 'base_unit',         ddl: "VARCHAR(10) NULL DEFAULT 'PCS'" },
    { col: 'pack_size',         ddl: 'INT NULL DEFAULT NULL' },
    { col: 'display_name',      ddl: 'VARCHAR(255) NULL DEFAULT NULL' },
  ];
  try {
    const cols = await _getCols();
    for (const m of migrations) {
      if (!cols.has(m.col)) {
        try {
          await db.query(`ALTER TABLE product_variants ADD COLUMN ${m.col} ${m.ddl}`);
          _cols = null;
          console.log(`[variantController] ${m.col} added to product_variants ✓`);
        } catch (e) {
          if (e.code !== 'ER_DUP_FIELDNAME') console.error('[variantController] migration error:', m.col, e.message);
        }
      }
    }
  } catch (e) {
    console.error('[variantController] _ensureCols error:', e.message);
  }
}
_ensureCols();

/* ── GET /api/v1/products/:id/variants ───────────────────── */
exports.list = async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (!productId) return res.status(400).json({ success: false, message: 'Invalid product ID' });

    const cols       = await _getCols();
    const distCol    = cols.has('distributor_price') ? ', distributor_price' : '';
    const mrpCol     = cols.has('mrp')               ? ', mrp'               : '';
    const bundleCols = [
      cols.has('is_bundle')     ? ', is_bundle'     : '',
      cols.has('base_quantity') ? ', base_quantity' : '',
      cols.has('base_unit')     ? ', base_unit'     : '',
      cols.has('pack_size')     ? ', pack_size'     : '',
      cols.has('display_name')  ? ', display_name'  : '',
    ].join('');
    const orderBy    = cols.has('sort_order') ? 'ORDER BY sort_order, id' : 'ORDER BY id';

    const [rows] = await db.query(
      `SELECT id, product_id, variant_name, size_value, size_unit,
              price${mrpCol}${distCol}${bundleCols}, stock, sku, is_active
       FROM product_variants
       WHERE product_id = ? AND is_active = 1 ${orderBy}`,
      [productId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[variantController.list]');
  }
};

/* ── POST /api/v1/products/:id/variants — bulk upsert ────── */
exports.bulkUpsert = async (req, res) => {
  let conn;
  try {
    const productId = parseInt(req.params.id, 10);
    if (!productId) return res.status(400).json({ success: false, message: 'Invalid product ID' });

    const { variants } = req.body;
    if (!Array.isArray(variants)) {
      return res.status(400).json({ success: false, message: 'variants must be an array' });
    }

    const [prod] = await db.query(
      'SELECT id FROM products WHERE id = ? AND is_active = 1', [productId]
    );
    if (!prod.length) return res.status(404).json({ success: false, message: 'Product not found' });

    // FIX: Validate ALL rows before starting transaction — fail early with clear message
    for (let i = 0; i < variants.length; i++) {
      const v = variants[i];
      const variantName = String(v.variant_name || '').trim();
      const price       = parseFloat(v.price);
      if (!variantName) {
        return res.status(422).json({ success: false, message: `Variant row ${i + 1}: variant_name is required` });
      }
      if (isNaN(price) || price <= 0) {
        return res.status(422).json({ success: false, message: `Variant row ${i + 1} ("${variantName}"): price must be a positive number` });
      }
    }

    const cols        = await _getCols();
    const hasDistCol  = cols.has('distributor_price');
    const hasMrpCol   = cols.has('mrp');
    const hasBundleCols = cols.has('is_bundle') && cols.has('base_quantity') &&
                          cols.has('base_unit') && cols.has('pack_size') && cols.has('display_name');

    conn = await db.getConnection();
    await conn.beginTransaction();

    // Soft-delete existing active variants for this product
    await conn.query(
      'UPDATE product_variants SET is_active = 0 WHERE product_id = ?',
      [productId]
    );

    for (const v of variants) {
      const variantName = String(v.variant_name || '').trim();
      const price       = parseFloat(v.price);
      const sizeValue   = parseFloat(v.size_value)  || 0;
      const sizeUnit    = v.size_unit || 'PCS';
      const stock       = parseInt(v.stock, 10)     || 0;
      const sku         = (v.sku != null && String(v.sku).trim()) ? String(v.sku).trim() : '';
      const mrp         = hasMrpCol  && v.mrp != null && !isNaN(parseFloat(v.mrp))
                          ? parseFloat(v.mrp) : null;
      const distPrice   = hasDistCol && v.distributor_price != null && !isNaN(parseFloat(v.distributor_price))
                          ? parseFloat(v.distributor_price) : null;

      // Bundle fields — only persist if columns exist
      const isBundle    = hasBundleCols ? (v.is_bundle ? 1 : 0) : null;
      const baseQty     = hasBundleCols && v.is_bundle && v.base_quantity != null && !isNaN(parseFloat(v.base_quantity))
                          ? parseFloat(v.base_quantity) : null;
      const baseUnit    = hasBundleCols && v.is_bundle ? (v.base_unit || 'PCS') : null;
      const packSize    = hasBundleCols && v.is_bundle && v.pack_size != null && !isNaN(parseInt(v.pack_size, 10))
                          ? parseInt(v.pack_size, 10) : null;
      const displayName = hasBundleCols && v.is_bundle && v.display_name
                          ? String(v.display_name).trim().slice(0, 255) : null;

      if (v.id) {
        // UPDATE existing row (re-activate it)
        const sets = [
          'variant_name=?','size_value=?','size_unit=?',
          'price=?','stock=?','sku=?','is_active=1',
        ];
        const vals = [variantName, sizeValue, sizeUnit, price, stock, sku];
        if (hasMrpCol)    { sets.push('mrp=?');               vals.push(mrp);         }
        if (hasDistCol)   { sets.push('distributor_price=?');  vals.push(distPrice);   }
        if (hasBundleCols){ sets.push('is_bundle=?','base_quantity=?','base_unit=?','pack_size=?','display_name=?');
                            vals.push(isBundle, baseQty, baseUnit, packSize, displayName); }
        vals.push(v.id, productId);
        await conn.query(
          `UPDATE product_variants SET ${sets.join(',')} WHERE id = ? AND product_id = ?`,
          vals
        );
      } else {
        // INSERT new row
        const iCols = ['product_id','variant_name','size_value','size_unit','price','stock','sku','is_active'];
        const iVals = [productId, variantName, sizeValue, sizeUnit, price, stock, sku, 1];
        if (hasMrpCol)    { iCols.push('mrp');               iVals.push(mrp);         }
        if (hasDistCol)   { iCols.push('distributor_price');  iVals.push(distPrice);   }
        if (hasBundleCols){ iCols.push('is_bundle','base_quantity','base_unit','pack_size','display_name');
                            iVals.push(isBundle, baseQty, baseUnit, packSize, displayName); }
        await conn.query(
          `INSERT INTO product_variants (${iCols.join(',')}) VALUES (${iCols.map(() => '?').join(',')})`,
          iVals
        );
      }
    }

    await conn.commit();
    res.json({ success: true, message: 'Variants saved', count: variants.length });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    serverError(res, err, '[variantController.bulkUpsert]');
  } finally {
    if (conn) { try { conn.release(); } catch (_) {} }
  }
};

/* ── DELETE /api/v1/products/:id/variants/:variantId ──────── */
exports.remove = async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    const variantId = parseInt(req.params.variantId, 10);
    if (!productId || !variantId) {
      return res.status(400).json({ success: false, message: 'Invalid ID' });
    }
    await db.query(
      'UPDATE product_variants SET is_active = 0 WHERE id = ? AND product_id = ?',
      [variantId, productId]
    );
    res.json({ success: true, message: 'Variant removed' });
  } catch (err) {
    serverError(res, err, '[variantController.remove]');
  }
};

exports.resetColsCache = function () { _cols = null; };
