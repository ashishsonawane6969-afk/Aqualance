'use strict';

const db     = require('../config/db');
const { serverError, parseId } = require('../utils/errors');
const { validatePhoto } = require('../utils/validatePhoto');
const bcrypt = require('../utils/bcrypt.js');

function today()        { return new Date().toISOString().slice(0, 10); }
function startOfMonth() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }

/* ── LEADS ──────────────────────────────────────────────────── */

exports.addLead = async (req, res) => {
  try {
    const { shop_name, shop_type, owner_name, mobile, village, taluka, district,
            sale_status, photo_proof, notes, visited_at, products } = req.body;

    // Defence-in-depth: verify photo_proof magic bytes match declared MIME type.
    const photoCheck = validatePhoto(photo_proof, 'photo_proof');
    if (!photoCheck.valid) {
      return res.status(422).json({ success: false, message: photoCheck.reason });
    }

    // ── Validate products array ───────────────────────────────
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one product is required.' });
    }
    for (const p of products) {
      if (!p.product_id || !Number.isInteger(Number(p.product_id))) {
        return res.status(400).json({ success: false, message: 'Each product must have a valid product_id.' });
      }
      if (typeof p.price === 'undefined' || parseFloat(p.price) < 0) {
        return res.status(400).json({ success: false, message: `Invalid price for product "${p.name}". Price must be >= 0.` });
      }
      const qty = parseInt(p.quantity, 10);
      if (!Number.isInteger(qty) || qty < 1) {
        return res.status(400).json({ success: false, message: `Invalid quantity for product "${p.name}". Quantity must be >= 1.` });
      }
    }

    const salesman_id = req.user.id;

    // ── Taluka restriction check ──────────────────────────────
    if (req.user.role === 'salesman') {
      const [areas] = await db.query(
        `SELECT id FROM salesman_areas WHERE salesman_id = ?`,
        [salesman_id]
      );
      if (areas.length > 0) {
        const [allowed] = await db.query(
          `SELECT id FROM salesman_areas WHERE salesman_id = ? AND LOWER(taluka) = LOWER(?)`,
          [salesman_id, taluka.trim()]
        );
        if (!allowed.length)
          return res.status(403).json({
            success: false,
            message: `You are not assigned to taluka "${taluka}". Please contact admin.`
          });
      }
    }

    let visitTime;
    if (visited_at) {
      const parsedDate = new Date(visited_at);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'visited_at must be a valid date/time (ISO 8601 format expected).'
        });
      }
      visitTime = parsedDate.toISOString().slice(0,19).replace('T', ' ');
    } else {
      visitTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    // ── Calculate grand total ─────────────────────────────────
    const grandTotal = products.reduce((sum, p) => {
      const t = parseFloat(p.price) * parseInt(p.quantity, 10);
      return sum + (isNaN(t) ? 0 : t);
    }, 0);

    // ── Insert lead ───────────────────────────────────────────
    const [result] = await db.query(
      `INSERT INTO shop_leads
         (salesman_id,shop_name,shop_type,owner_name,mobile,village,taluka,district,sale_status,grand_total,photo_proof,notes,visited_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [salesman_id, shop_name.trim(), shop_type || '', owner_name.trim(), mobile.trim(),
       village.trim(), taluka.trim(), district.trim(),
       sale_status || 'NO', grandTotal, photo_proof || null, notes?.trim() || null, visitTime]
    );

    const leadId = result.insertId;

    // ── Verify product IDs exist ──────────────────────────────
    const productIds = products.map(p => Number(p.product_id));
    const [dbProducts] = await db.query(
      `SELECT id FROM products WHERE id IN (?)`,
      [productIds]
    );
    const validIds = new Set(dbProducts.map(p => p.id));
    const invalidProduct = products.find(p => !validIds.has(Number(p.product_id)));
    if (invalidProduct) {
      await db.query('DELETE FROM shop_leads WHERE id = ?', [leadId]);
      return res.status(400).json({ success: false, message: `Product ID ${invalidProduct.product_id} does not exist.` });
    }

    // ── Insert lead_products ──────────────────────────────────
    const lpRows = products.map(p => [
      leadId,
      Number(p.product_id),
      String(p.name || '').trim().slice(0, 150),
      parseFloat(p.price),
      parseInt(p.quantity, 10),
      parseFloat(p.price) * parseInt(p.quantity, 10)
    ]);

    try {
      await db.query(
        `INSERT INTO lead_products (lead_id, product_id, name, price, quantity, total) VALUES ?`,
        [lpRows]
      );
    } catch (lpErr) {
      if (lpErr.code === 'ER_NO_SUCH_TABLE') {
        // Clean up the lead we just inserted since products can't be saved
        await db.query('DELETE FROM shop_leads WHERE id = ?', [leadId]);
        return res.status(503).json({
          success: false,
          message: 'Database not set up. Please run database/aqualence_complete.sql first.',
        });
      }
      throw lpErr;
    }

    res.status(201).json({ success: true, id: leadId, message: 'Lead added successfully' });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

exports.getLeads = async (req, res) => {
  try {
    const { from, to, sale_status, district, taluka } = req.query;
    const page    = Math.max(1, parseInt(req.query.page, 10)     || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.per_page, 10) || 100));
    const offset  = (page - 1) * perPage;

    const whereSql = [
      'FROM shop_leads sl JOIN users u ON sl.salesman_id = u.id WHERE 1=1',
    ];
    const params = [];

    if (req.user.role === 'salesman') {
      whereSql.push('AND sl.salesman_id = ?');
      params.push(req.user.id);
    }
    if (from)        { whereSql.push('AND DATE(sl.visited_at) >= ?'); params.push(from); }
    if (to)          { whereSql.push('AND DATE(sl.visited_at) <= ?'); params.push(to); }
    if (sale_status) { whereSql.push('AND sl.sale_status = ?');       params.push(sale_status); }
    if (district)    { whereSql.push('AND sl.district = ?');          params.push(district); }
    if (taluka)      { whereSql.push('AND sl.taluka = ?');            params.push(taluka); }

    const where = whereSql.join(' ');

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${where}`, params);
    const [rows] = await db.query(
      `SELECT sl.*, u.name AS salesman_name ${where} ORDER BY sl.visited_at DESC LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    // ── Attach lead_products to each lead ─────────────────────
    // Gracefully handles the case where lead_products table doesn't exist yet
    // (migration not yet run) — leads still load, products array is just empty.
    if (rows.length) {
      try {
        const leadIds = rows.map(r => r.id);
        const [lpRows] = await db.query(
          `SELECT lp.lead_id, lp.id, lp.product_id,
                  COALESCE(NULLIF(lp.name,''), p.name, 'Unknown Product') AS name,
                  COALESCE(lp.price, 0)    AS price,
                  COALESCE(lp.quantity, 1) AS quantity,
                  COALESCE(lp.total, 0)    AS total,
                  p.category
           FROM lead_products lp
           LEFT JOIN products p ON lp.product_id = p.id
           WHERE lp.lead_id IN (?)
           ORDER BY lp.lead_id, lp.id`,
          [leadIds]
        );
        const byLead = {};
        for (const lp of lpRows) {
          if (!byLead[lp.lead_id]) byLead[lp.lead_id] = [];
          byLead[lp.lead_id].push({
            id: lp.id, product_id: lp.product_id, name: lp.name,
            price: parseFloat(lp.price), quantity: parseInt(lp.quantity, 10),
            total: parseFloat(lp.total), category: lp.category || null,
          });
        }
        for (const row of rows) row.products = byLead[row.id] || [];
      } catch (lpErr) {
        // Table doesn't exist yet — return empty products array, don't crash
        if (lpErr.code === 'ER_NO_SUCH_TABLE') {
          for (const row of rows) row.products = [];
        } else {
          throw lpErr; // re-throw unexpected errors
        }
      }
    }

    res.json({ success: true, data: rows, pagination: { total, page, per_page: perPage } });
  } catch (err) {
    serverError(res, err, '[salesmanController.getLeads]');
  }
};

exports.getLead = async (req, res) => {
  try {
    const leadId = parseId(req.params.id);
    if (!leadId) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const [rows] = await db.query(
      `SELECT sl.*, u.name AS salesman_name FROM shop_leads sl JOIN users u ON sl.salesman_id = u.id WHERE sl.id = ?`,
      [leadId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (req.user.role === 'salesman' && rows[0].salesman_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const [lpRows] = await (async () => {
      try {
        return await db.query(
          `SELECT lp.*, p.category FROM lead_products lp
           LEFT JOIN products p ON lp.product_id = p.id WHERE lp.lead_id = ? ORDER BY lp.id`,
          [leadId]
        );
      } catch (lpErr) {
        if (lpErr.code === 'ER_NO_SUCH_TABLE') return [[]];
        throw lpErr;
      }
    })();
    rows[0].products = lpRows.map(lp => ({
      id: lp.id, product_id: lp.product_id, name: lp.name,
      price: parseFloat(lp.price), quantity: lp.quantity,
      total: parseFloat(lp.total), category: lp.category || null,
    }));

    res.json({ success: true, data: rows[0] });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

exports.updateLead = async (req, res) => {
  try {
    const leadId = parseId(req.params.id);
    if (!leadId) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const [rows] = await db.query('SELECT * FROM shop_leads WHERE id = ?', [leadId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Lead not found' });
    if (req.user.role === 'salesman' && rows[0].salesman_id !== req.user.id)
      return res.status(403).json({ success: false, message: 'Forbidden' });

    const { shop_name, shop_type, owner_name, mobile, village, taluka, district,
            sale_status, photo_proof, notes, products } = req.body;

    const photoCheck = validatePhoto(photo_proof, 'photo_proof');
    if (!photoCheck.valid) {
      return res.status(422).json({ success: false, message: photoCheck.reason });
    }

    let grandTotal = parseFloat(rows[0].grand_total) || 0;

    if (Array.isArray(products) && products.length > 0) {
      for (const p of products) {
        if (parseFloat(p.price) < 0)
          return res.status(400).json({ success: false, message: `Invalid price for product "${p.name}".` });
        if (!Number.isInteger(parseInt(p.quantity,10)) || parseInt(p.quantity,10) < 1)
          return res.status(400).json({ success: false, message: `Invalid quantity for product "${p.name}".` });
      }
      grandTotal = products.reduce((s, p) => {
        const t = parseFloat(p.price) * parseInt(p.quantity, 10);
        return s + (isNaN(t) ? 0 : t);
      }, 0);

      await db.query('DELETE FROM lead_products WHERE lead_id = ?', [leadId]);
      const lpRows = products.map(p => [
        leadId, Number(p.product_id),
        String(p.name || '').trim().slice(0, 150),
        parseFloat(p.price), parseInt(p.quantity, 10),
        parseFloat(p.price) * parseInt(p.quantity, 10)
      ]);
      await db.query(
        `INSERT INTO lead_products (lead_id, product_id, name, price, quantity, total) VALUES ?`,
        [lpRows]
      );
    }

    const updateFields = [];
    const updateParams = [];

    if (shop_name   !== undefined) { updateFields.push('shop_name=?');   updateParams.push(shop_name.trim()); }
    if (shop_type   !== undefined) { updateFields.push('shop_type=?');   updateParams.push(shop_type || ''); }
    if (owner_name  !== undefined) { updateFields.push('owner_name=?');  updateParams.push(owner_name.trim()); }
    if (mobile      !== undefined) { updateFields.push('mobile=?');      updateParams.push(mobile.trim()); }
    if (village     !== undefined) { updateFields.push('village=?');     updateParams.push(village.trim()); }
    if (taluka      !== undefined) { updateFields.push('taluka=?');      updateParams.push(taluka.trim()); }
    if (district    !== undefined) { updateFields.push('district=?');    updateParams.push(district.trim()); }
    if (sale_status !== undefined) { updateFields.push('sale_status=?'); updateParams.push(sale_status); }
    if (notes       !== undefined) { updateFields.push('notes=?');       updateParams.push(notes?.trim() || null); }

    // Always update grand_total as it is recalculated
    updateFields.push('grand_total=?');
    updateParams.push(grandTotal);

    if (photo_proof !== undefined) {
      updateFields.push('photo_proof=?');
      updateParams.push(photo_proof || null);
    }

    if (updateFields.length === 0) {
      return res.json({ success: true, message: 'No changes made' });
    }

    updateParams.push(leadId);

    await db.query(
      `UPDATE shop_leads SET ${updateFields.join(',')} WHERE id=?`,
      updateParams
    );
    res.json({ success: true, message: 'Lead updated' });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

exports.deleteLead = async (req, res) => {
  try {
    const leadId = parseId(req.params.id);
    if (!leadId) return res.status(400).json({ success: false, message: 'Invalid lead ID' });
    const [rows] = await db.query('SELECT id FROM shop_leads WHERE id = ?', [leadId]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Lead not found' });
    await db.query('DELETE FROM shop_leads WHERE id = ?', [leadId]);
    res.json({ success: true, message: 'Lead deleted' });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

/* ── REPORTS ─────────────────────────────────────────────────── */

exports.getReport = async (req, res) => {
  try {
    const { from, to } = req.query;
    const rangeFrom = from || '2000-01-01';
    const rangeTo   = to   || today();
    const t = today(), mStart = startOfMonth();
    const isAdmin    = req.user.role === 'admin';
    const salesmanId = isAdmin ? null : req.user.id;
    const cond       = salesmanId ? 'AND salesman_id = ?' : '';
    const condParams = salesmanId ? [salesmanId]          : [];

    const [[range]] = await db.query(
      `SELECT COUNT(*) AS total_leads,
        SUM(CASE WHEN sale_status='YES' THEN 1 ELSE 0 END) AS yes_leads,
        SUM(CASE WHEN sale_status='NO' THEN 1 ELSE 0 END) AS no_leads
       FROM shop_leads WHERE DATE(visited_at) BETWEEN ? AND ? ${cond}`,
      [rangeFrom, rangeTo, ...condParams]
    );
    const [[todayRow]] = await db.query(
      `SELECT COUNT(*) AS today_leads,
        SUM(CASE WHEN sale_status='YES' THEN 1 ELSE 0 END) AS today_orders,
        COUNT(*) AS today_visits
       FROM shop_leads WHERE DATE(visited_at) = ? ${cond}`,
      [t, ...condParams]
    );
    const [[monthRow]] = await db.query(
      `SELECT COUNT(*) AS month_leads FROM shop_leads WHERE DATE(visited_at) >= ? ${cond}`,
      [mStart, ...condParams]
    );
    const [daily] = await db.query(
      `SELECT DATE(visited_at) AS date, COUNT(*) AS total,
        SUM(CASE WHEN sale_status='YES' THEN 1 ELSE 0 END) AS yes_count,
        SUM(CASE WHEN sale_status='NO' THEN 1 ELSE 0 END) AS no_count
       FROM shop_leads WHERE DATE(visited_at) BETWEEN ? AND ? ${cond}
       GROUP BY DATE(visited_at) ORDER BY date ASC`,
      [rangeFrom, rangeTo, ...condParams]
    );
    const [byDistrict] = await db.query(
      `SELECT district, COUNT(*) AS count, SUM(CASE WHEN sale_status='YES' THEN 1 ELSE 0 END) AS sales
       FROM shop_leads WHERE DATE(visited_at) BETWEEN ? AND ? ${cond}
       GROUP BY district ORDER BY count DESC LIMIT 10`,
      [rangeFrom, rangeTo, ...condParams]
    );
    let leaderboard = [];
    if (isAdmin) {
      const [lb] = await db.query(
        `SELECT u.id, u.name, u.phone,
                COUNT(sl.id) AS total,
                SUM(CASE WHEN sl.sale_status='YES' THEN 1 ELSE 0 END) AS sales,
                SUM(CASE WHEN sl.sale_status='NO' THEN 1 ELSE 0 END) AS no_sales,
                MAX(sl.visited_at) AS last_visit
         FROM users u
         LEFT JOIN shop_leads sl ON sl.salesman_id = u.id AND DATE(sl.visited_at) BETWEEN ? AND ?
         WHERE u.role = 'salesman' AND u.is_active = 1
         GROUP BY u.id, u.name, u.phone ORDER BY total DESC`,
        [rangeFrom, rangeTo]
      );
      leaderboard = lb;
    }
    res.json({
      success: true,
      data: {
        range:        { from: rangeFrom, to: rangeTo },
        total_leads:  parseInt(range.total_leads)  || 0,
        yes_leads:    parseInt(range.yes_leads)    || 0,
        no_leads:     parseInt(range.no_leads)     || 0,
        today_visits: parseInt(todayRow.today_visits) || 0,
        today_orders: parseInt(todayRow.today_orders) || 0,
        today_leads:  parseInt(todayRow.today_leads)  || 0,
        month_leads:  parseInt(monthRow.month_leads)  || 0,
        daily, byDistrict, leaderboard,
      }
    });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

/* ── SALESMAN MANAGEMENT (admin only) ───────────────────────── */

exports.listSalesmen = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.phone, u.is_active, u.created_at,
              COUNT(DISTINCT sl.id) AS total_leads,
              SUM(CASE WHEN sl.sale_status='YES' THEN 1 ELSE 0 END) AS total_sales,
              MAX(sl.visited_at) AS last_visit,
              (SELECT COUNT(*) FROM salesman_areas sa WHERE sa.salesman_id = u.id) AS area_count
       FROM users u
       LEFT JOIN shop_leads sl ON sl.salesman_id = u.id
       WHERE u.role = 'salesman'
       GROUP BY u.id, u.name, u.phone, u.is_active, u.created_at ORDER BY u.name`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

exports.addSalesman = async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    const hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12);
    const [result] = await db.query(
      "INSERT INTO users (name, phone, password, role) VALUES (?,?,?,'salesman')",
      [name.trim(), phone.trim(), hash]
    );
    res.status(201).json({ success: true, id: result.insertId, message: 'Salesman added' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY')
      return res.status(400).json({ success: false, message: 'Phone number already registered' });
    serverError(res, err, '[salesmanController]');
  }
};

exports.removeSalesman = async (req, res) => {
  try {
    const smId = parseId(req.params.id);
    if (!smId) return res.status(400).json({ success: false, message: 'Invalid salesman ID' });
    await db.query("UPDATE users SET is_active=0 WHERE id=? AND role='salesman'", [smId]);
    res.json({ success: true, message: 'Salesman deactivated' });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

/* ── TALUKA / AREA ASSIGNMENT ───────────────────────────────── */

const { ensureGeoTables } = require('./geoController');

exports.getSalesmanAreas = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid salesman ID' });
    const [rows] = await db.query(
      `SELECT id, taluka, district, assigned_at FROM salesman_areas WHERE salesman_id = ? ORDER BY district, taluka`,
      [id]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

exports.getMyAreas = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT taluka, district FROM salesman_areas WHERE salesman_id = ? ORDER BY district, taluka`,
      [req.user.id]
    );
    res.json({ success: true, data: rows, restricted: rows.length > 0 });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

exports.assignArea = async (req, res) => {
  try {
    const { taluka, district } = req.body;
    const salesmanId = parseId(req.params.id);
    if (!salesmanId) return res.status(400).json({ success: false, message: 'Invalid salesman ID' });
    const [users] = await db.query("SELECT id FROM users WHERE id=? AND role='salesman'", [salesmanId]);
    if (!users.length) return res.status(404).json({ success: false, message: 'Salesman not found' });
    await db.query(
      `INSERT IGNORE INTO salesman_areas (salesman_id, taluka, district, assigned_by) VALUES (?,?,?,?)`,
      [salesmanId, taluka.trim(), district.trim(), req.user.id]
    );
    try {
      const [[{ areaCount }]] = await db.query(
        'SELECT COUNT(*) AS areaCount FROM salesman_areas WHERE salesman_id = ?', [salesmanId]
      );
      if (areaCount === 1) {
        const [tkRows] = await db.query(
          `SELECT id FROM talukas WHERE LOWER(name) = LOWER(?) AND is_active = 1 LIMIT 1`, [taluka.trim()]
        );
        if (tkRows.length)
          await db.query('UPDATE users SET taluka_id = ?, taluka_name = ? WHERE id = ?', [tkRows[0].id, taluka.trim(), salesmanId]);
      } else {
        await db.query('UPDATE users SET taluka_id = NULL, taluka_name = NULL WHERE id = ?', [salesmanId]);
      }
    } catch (syncErr) { console.warn('[assignArea] taluka_id sync warning:', syncErr.message); }
    res.json({ success: true, message: `${taluka} assigned successfully` });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};

exports.removeArea = async (req, res) => {
  try {
    const salesmanId = parseId(req.params.id);
    const areaId     = parseId(req.params.areaId);
    if (!salesmanId || !areaId) return res.status(400).json({ success: false, message: 'Invalid ID parameter' });
    await db.query(`DELETE FROM salesman_areas WHERE id=? AND salesman_id=?`, [areaId, salesmanId]);
    const [[{ remaining }]] = await db.query('SELECT COUNT(*) AS remaining FROM salesman_areas WHERE salesman_id = ?', [salesmanId]);
    try {
      if (remaining === 0) {
        await db.query('UPDATE users SET taluka_id = NULL, taluka_name = NULL WHERE id = ?', [salesmanId]);
      } else if (remaining === 1) {
        const [[lastArea]] = await db.query('SELECT taluka FROM salesman_areas WHERE salesman_id = ? LIMIT 1', [salesmanId]);
        const [tkRows] = await db.query(`SELECT id FROM talukas WHERE LOWER(name) = LOWER(?) AND is_active = 1 LIMIT 1`, [lastArea.taluka]);
        if (tkRows.length)
          await db.query('UPDATE users SET taluka_id = ?, taluka_name = ? WHERE id = ?', [tkRows[0].id, lastArea.taluka, salesmanId]);
      }
    } catch (syncErr) { console.warn('[removeArea] taluka_id sync warning:', syncErr.message); }
    res.json({ success: true, message: 'Area removed' });
  } catch (err) {
    serverError(res, err, '[salesmanController]');
  }
};
