'use strict';

const db    = require('../config/db');
const { serverError, parseId } = require('../utils/errors');
const bcrypt = require('../utils/bcrypt.js');

/* ── BUG FIX: Validate delivery_id against the authenticated user ─────────
   Previously, any delivery boy could view ANY other delivery boy's orders
   just by changing the URL param. Now enforced: delivery can only see
   their own orders; admin can see all.
───────────────────────────────────────────────────────────────────────── */

exports.getOrders = async (req, res) => {
  try {
    const requestedId = parseId(req.params.delivery_id);
    if (!requestedId) return res.status(400).json({ success: false, message: 'Invalid delivery ID' });

    // Security check: delivery boy can only fetch their own orders
    if (req.user.role === 'delivery' && req.user.id !== requestedId) {
      return res.status(403).json({ success: false, message: 'Forbidden: cannot access other delivery partner orders' });
    }

    const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 50));
    const offset  = (page - 1) * perPage;

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM orders WHERE delivery_id = ? AND status != ?',
      [requestedId, 'cancelled']
    );
    const [orders] = await db.query(
      `SELECT * FROM orders WHERE delivery_id = ? AND status != 'cancelled'
       ORDER BY FIELD(status,'out_for_delivery','assigned','delivered'), created_at DESC
       LIMIT ? OFFSET ?`,
      [requestedId, perPage, offset]
    );
    res.json({ success: true, data: orders, pagination: { total, page, per_page: perPage } });
  } catch (err) {
    serverError(res, err, '[deliveryController]');
  }
};

exports.getOrderDetail = async (req, res) => {
  try {
    const requestedDeliveryId = parseId(req.params.delivery_id);
    const orderId             = parseId(req.params.order_id);

    if (!requestedDeliveryId || !orderId) {
      return res.status(400).json({ success: false, message: 'Invalid ID parameter' });
    }

    // Security check: delivery boy can only view their own order details
    if (req.user.role === 'delivery' && req.user.id !== requestedDeliveryId) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const [orders] = await db.query(
      'SELECT * FROM orders WHERE id = ? AND delivery_id = ?',
      [orderId, requestedDeliveryId]
    );
    if (!orders.length) return res.status(404).json({ success: false, message: 'Not found' });

    const [items] = await db.query(
      'SELECT oi.*, p.image FROM order_items oi LEFT JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?',
      [orderId]
    );
    res.json({ success: true, data: { ...orders[0], items } });
  } catch (err) {
    serverError(res, err, '[deliveryController]');
  }
};

/* ── Admin: list all delivery boys ─────────────────────────── */
exports.listDeliveryBoys = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT id, name, phone, is_active, created_at FROM users WHERE role='delivery' ORDER BY name"
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[deliveryController]');
  }
};

/* ── Admin: add delivery boy ────────────────────────────────── */
exports.addDeliveryBoy = async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    // All fields validated by deliveryBoySchema middleware

    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
    const [result] = await db.query(
      "INSERT INTO users (name, phone, password, role) VALUES (?,?,?,'delivery')",
      [name.trim(), phone.trim(), hash]
    );
    res.status(201).json({ success: true, id: result.insertId, message: 'Delivery boy added' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ success: false, message: 'Phone number already exists' });
    serverError(res, err, '[deliveryController]');
  }
};

/* ── Admin: deactivate delivery boy ─────────────────────────── */
exports.removeDeliveryBoy = async (req, res) => {
  try {
    const boyId = parseId(req.params.id);
    if (!boyId) return res.status(400).json({ success: false, message: 'Invalid ID' });
    await db.query('UPDATE users SET is_active = 0 WHERE id = ? AND role = ?', [boyId, 'delivery']);
    res.json({ success: true, message: 'Delivery boy removed' });
  } catch (err) {
    serverError(res, err, '[deliveryController]');
  }
};
