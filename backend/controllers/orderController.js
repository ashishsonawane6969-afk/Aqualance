/**
 * controllers/orderController.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Security fixes applied in this version:
 *  - err.message no longer sent to client (was leaking DB schema/query info)
 *  - getAll now validates and sanitises ?status query param (enum-checked)
 *  - getAll has pagination (LIMIT/OFFSET) to prevent unbounded result DoS
 *  - Duplicate in-controller validation removed (Joi middleware owns validation)
 * ─────────────────────────────────────────────────────────────────────────────
 */
'use strict';

const db = require('../config/db');
const { serverError } = require('../utils/errors');

const VALID_STATUSES = ['pending', 'assigned', 'out_for_delivery', 'delivered', 'cancelled'];

function genOrderNumber() {
  const d   = new Date();
  const yy  = String(d.getFullYear()).slice(2);
  const mm  = String(d.getMonth() + 1).padStart(2, '0');
  const dd  = String(d.getDate()).padStart(2, '0');
  const rnd = Math.floor(1000 + Math.random() * 9000);
  return `AQ-${yy}${mm}${dd}-${rnd}`;
}

exports.create = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { customer_name, shop_name, phone, address, city, pincode,
            latitude, longitude, notes, products } = req.body;

    // Fetch product prices + stock from DB (never trust client price)
    const productIds   = [...new Set(products.map(p => p.id))];
    const [dbProducts] = await conn.query(
      `SELECT id, name, price, stock, is_active FROM products WHERE id IN (${productIds.map(() => '?').join(',')})`,
      productIds
    );
    const dbMap = {};
    for (const p of dbProducts) dbMap[p.id] = p;

    // Fetch variants where variant_id is provided
    const variantIds = products.filter(p => p.variant_id).map(p => p.variant_id);
    const variantMap = {};
    if (variantIds.length > 0) {
      const [dbVariants] = await conn.query(
        `SELECT id, product_id, variant_name, price, stock, is_active
         FROM product_variants WHERE id IN (${variantIds.map(() => '?').join(',')}) AND is_active = 1`,
        variantIds
      );
      for (const v of dbVariants) variantMap[v.id] = v;
    }

    // Validate stock for each line item
    for (const item of products) {
      const dbP = dbMap[item.id];
      if (!dbP) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: `Product ID ${item.id} not found` });
      }
      if (!dbP.is_active) {
        await conn.rollback();
        return res.status(400).json({ success: false, message: `Product "${dbP.name}" is no longer available` });
      }
      if (item.variant_id) {
        const v = variantMap[item.variant_id];
        if (!v || v.product_id !== item.id) {
          await conn.rollback();
          return res.status(400).json({ success: false, message: `Variant not found for "${dbP.name}"` });
        }
        if (v.stock < item.quantity) {
          await conn.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for "${dbP.name}" (${v.variant_name}). Available: ${v.stock}, Requested: ${item.quantity}`,
          });
        }
      } else {
        if (dbP.stock < item.quantity) {
          await conn.rollback();
          return res.status(400).json({
            success: false,
            message: `Insufficient stock for "${dbP.name}". Available: ${dbP.stock}, Requested: ${item.quantity}`,
          });
        }
      }
    }

    // Calculate total using variant price when available
    let total = 0;
    for (const item of products) {
      const price = item.variant_id && variantMap[item.variant_id]
        ? parseFloat(variantMap[item.variant_id].price)
        : parseFloat(dbMap[item.id].price);
      total += price * item.quantity;
    }

    const orderNumber   = genOrderNumber();
    const [orderResult] = await conn.query(
      `INSERT INTO orders (order_number,customer_name,shop_name,phone,address,city,pincode,latitude,longitude,total_price,notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [orderNumber, customer_name, shop_name, phone, address, city, pincode,
       latitude != null ? parseFloat(latitude) : null,
       longitude != null ? parseFloat(longitude) : null,
       total, notes || null]
    );

    const orderId = orderResult.insertId;
    for (const item of products) {
      const dbP    = dbMap[item.id];
      const v      = item.variant_id ? variantMap[item.variant_id] : null;
      const price  = v ? parseFloat(v.price) : parseFloat(dbP.price);
      const pName  = v ? `${dbP.name} (${v.variant_name})` : dbP.name;

      await conn.query(
        'INSERT INTO order_items (order_id,product_id,variant_id,product_name,quantity,price) VALUES (?,?,?,?,?,?)',
        [orderId, item.id, item.variant_id || null, pName, item.quantity, price]
      );

      if (v) {
        // Deduct variant stock
        await conn.query(
          'UPDATE product_variants SET stock = GREATEST(0, stock - ?) WHERE id = ?',
          [item.quantity, v.id]
        );
      } else {
        // Deduct product stock
        await conn.query(
          'UPDATE products SET stock = GREATEST(0, stock - ?) WHERE id = ?',
          [item.quantity, item.id]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ success: true, order_number: orderNumber, order_id: orderId, total });
  } catch (err) {
    await conn.rollback();
    serverError(res, err, '[orderController.create]');
  } finally {
    conn.release();
  }
};

exports.getAll = async (req, res) => {
  try {
    // SECURITY FIX: validate status query param to enum; reject unknown values.
    // Previously accepted any string — while parameterised (safe from SQLi),
    // returning 0 results for garbage input is still confusing and wasteful.
    const { status } = req.query;
    if (status && status !== 'all' && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status filter' });
    }

    // SECURITY FIX: pagination to prevent unbounded result sets.
    // An admin page with 50,000 orders would previously return all of them.
    const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 50));
    const offset  = (page - 1) * perPage;

    let countSql = 'SELECT COUNT(*) AS total FROM orders o';
    let sql = `
      SELECT o.*, u.name AS delivery_name
      FROM orders o
      LEFT JOIN users u ON o.delivery_id = u.id
    `;
    const params = [];
    if (status && status !== 'all') {
      sql      += ' WHERE o.status = ?';
      countSql += ' WHERE o.status = ?';
      params.push(status);
    }
    sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';

    const [[{ total }]] = await db.query(countSql, params);
    const [orders]      = await db.query(sql, [...params, perPage, offset]);

    res.json({ success: true, data: orders, pagination: { total, page, per_page: perPage } });
  } catch (err) {
    serverError(res, err, '[orderController.getAll]');
  }
};

exports.getOne = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid order ID' });

    const [orders] = await db.query(
      `SELECT o.*, u.name AS delivery_name, u.phone AS delivery_phone
       FROM orders o LEFT JOIN users u ON o.delivery_id = u.id
       WHERE o.id = ?`, [id]
    );
    if (!orders.length) return res.status(404).json({ success: false, message: 'Order not found' });

    const [items] = await db.query(
      'SELECT oi.*, p.image FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
      [id]
    );
    res.json({ success: true, data: { ...orders[0], items } });
  } catch (err) {
    serverError(res, err, '[orderController.getOne]');
  }
};

exports.assignDelivery = async (req, res) => {
  try {
    // Validated by orderAssignSchema middleware
    const { order_id, delivery_id } = req.body;

    const [boys] = await db.query(
      "SELECT id FROM users WHERE id = ? AND role = 'delivery' AND is_active = 1",
      [delivery_id]
    );
    if (!boys.length)
      return res.status(400).json({ success: false, message: 'Delivery boy not found or inactive' });

    const [result] = await db.query(
      "UPDATE orders SET delivery_id = ?, status = 'assigned' WHERE id = ?",
      [delivery_id, order_id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ success: false, message: 'Order not found' });

    res.json({ success: true, message: 'Delivery boy assigned' });
  } catch (err) {
    serverError(res, err, '[orderController.assignDelivery]');
  }
};

exports.updateStatus = async (req, res) => {
  try {
    // Validated by orderStatusSchema middleware
    const { order_id, status } = req.body;

    let sql      = 'UPDATE orders SET status = ? WHERE id = ?';
    const params = [status, order_id];
    if (req.user.role === 'delivery') {
      sql += ' AND delivery_id = ?';
      params.push(req.user.id);
    }

    const [result] = await db.query(sql, params);
    if (result.affectedRows === 0)
      return res.status(404).json({ success: false, message: 'Order not found or not assigned to you' });

    res.json({ success: true, message: 'Status updated' });
  } catch (err) {
    serverError(res, err, '[orderController.updateStatus]');
  }
};

exports.getStats = async (req, res) => {
  try {
    const [[totals]]        = await db.query(`
      SELECT COUNT(*) AS total_orders,
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='assigned' THEN 1 ELSE 0 END) AS assigned,
        SUM(CASE WHEN status='out_for_delivery' THEN 1 ELSE 0 END) AS out_for_delivery,
        SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END) AS revenue
      FROM orders
    `);
    const [[productCount]]  = await db.query('SELECT COUNT(*) AS count FROM products WHERE is_active=1');
    const [[deliveryCount]] = await db.query("SELECT COUNT(*) AS count FROM users WHERE role='delivery' AND is_active=1");
    res.json({ success: true, data: { ...totals, products: productCount.count, delivery_boys: deliveryCount.count } });
  } catch (err) {
    serverError(res, err, '[orderController.getStats]');
  }
};

exports.getOverview = async (req, res) => {
  try {
    const [[totals]]     = await db.query(`
      SELECT COUNT(*) AS total_orders,
        SUM(CASE WHEN status='pending'          THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status='assigned'         THEN 1 ELSE 0 END) AS assigned,
        SUM(CASE WHEN status='out_for_delivery' THEN 1 ELSE 0 END) AS out_for_delivery,
        SUM(CASE WHEN status='delivered'        THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status='cancelled'        THEN 1 ELSE 0 END) AS cancelled,
        COALESCE(SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END),0) AS total_revenue,
        COALESCE(AVG(CASE WHEN status='delivered' THEN total_price END),0)        AS avg_order_value
      FROM orders
    `);
    const [dailyOrders]  = await db.query(`
      SELECT DATE(created_at) AS date, COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END),0) AS revenue
      FROM orders WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)
      GROUP BY DATE(created_at) ORDER BY date ASC
    `);
    const [monthlyOrders] = await db.query(`
      SELECT DATE(created_at) AS date, COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END),0) AS revenue
      FROM orders WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
      GROUP BY DATE(created_at) ORDER BY date ASC
    `);
    const [topProducts]  = await db.query(`
      SELECT oi.product_name,
        SUM(oi.quantity)            AS total_qty,
        SUM(oi.quantity * oi.price) AS total_revenue,
        COUNT(DISTINCT oi.order_id) AS order_count
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'delivered'
      GROUP BY oi.product_name ORDER BY total_qty DESC LIMIT 8
    `);
    const [cityBreakdown] = await db.query(`
      SELECT city, COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END),0) AS revenue
      FROM orders GROUP BY city ORDER BY orders DESC LIMIT 8
    `);
    const statusBreakdown = {
      pending:          parseInt(totals.pending)          || 0,
      assigned:         parseInt(totals.assigned)         || 0,
      out_for_delivery: parseInt(totals.out_for_delivery) || 0,
      delivered:        parseInt(totals.delivered)        || 0,
      cancelled:        parseInt(totals.cancelled)        || 0,
    };
    const [[today]]    = await db.query(`
      SELECT COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END),0) AS revenue
      FROM orders WHERE DATE(created_at) = CURDATE()
    `);
    const [[thisWeek]] = await db.query(`
      SELECT COUNT(*) AS orders,
        COALESCE(SUM(CASE WHEN status='delivered' THEN total_price ELSE 0 END),0) AS revenue
      FROM orders WHERE YEARWEEK(created_at,1) = YEARWEEK(CURDATE(),1)
    `);
    res.json({ success: true, data: { totals, today, thisWeek, dailyOrders, monthlyOrders, topProducts, cityBreakdown, statusBreakdown } });
  } catch (err) {
    serverError(res, err, '[orderController.getOverview]');
  }
};

exports.getLeaderboard = async (req, res) => {
  try {
    const [leaderboard] = await db.query(`
      SELECT u.id, u.name, u.phone, u.is_active,
        COUNT(o.id) AS total_assigned,
        SUM(CASE WHEN o.status='delivered'        THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN o.status='out_for_delivery' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN o.status='assigned'         THEN 1 ELSE 0 END) AS pending_pickup,
        COALESCE(SUM(CASE WHEN o.status='delivered' THEN o.total_price ELSE 0 END),0) AS revenue_delivered,
        ROUND(
          COALESCE(SUM(CASE WHEN o.status='delivered' THEN 1 ELSE 0 END),0) * 100.0
          / NULLIF(COUNT(o.id), 0), 1
        ) AS completion_rate
      FROM users u
      LEFT JOIN orders o ON o.delivery_id = u.id
      WHERE u.role = 'delivery'
      GROUP BY u.id, u.name, u.phone, u.is_active
      ORDER BY delivered DESC, completion_rate DESC
    `);
    const [recentActivity] = await db.query(`
      SELECT u.id AS delivery_id, DATE(o.updated_at) AS date, COUNT(*) AS deliveries
      FROM orders o JOIN users u ON u.id = o.delivery_id
      WHERE o.status = 'delivered' AND o.updated_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY u.id, DATE(o.updated_at) ORDER BY date ASC
    `);
    res.json({ success: true, data: { leaderboard, recentActivity } });
  } catch (err) {
    serverError(res, err, '[orderController.getLeaderboard]');
  }
};
