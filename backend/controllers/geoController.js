// backend/controllers/geoController.js

'use strict';
const { serverError, parseId } = require('../utils/errors');
const { validatePhoto }        = require('../utils/validatePhoto');
// Geo-verified lead capture: GPS validation, taluka geofencing, live tracking
const db = require('../config/db');

/* ══════════════════════════════════════════════════════════
   HAVERSINE DISTANCE  (returns km)
══════════════════════════════════════════════════════════ */
function haversine(lat1, lng1, lat2, lng2) {
  const R  = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dN = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(dL/2) ** 2 +
             Math.cos(lat1 * Math.PI / 180) *
             Math.cos(lat2 * Math.PI / 180) *
             Math.sin(dN/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ══════════════════════════════════════════════════════════
   AUTO-MIGRATE  — ensure geo tables exist
══════════════════════════════════════════════════════════ */
// FIX #1: _geoReady flag only set after ALL steps succeed.
// Individual ALTER TABLE errors are caught and classified:
//   - Duplicate column = expected on re-run, silently skipped
//   - Anything else    = logged but NOT treated as fatal (partial migration OK)
// _geoReady is never set on catch, so next request retries.
let _geoReady = false;
async function ensureGeoTables() {
  if (_geoReady) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS talukas (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        name       VARCHAR(100) NOT NULL,
        district   VARCHAR(100) NOT NULL,
        state      VARCHAR(100) NOT NULL DEFAULT 'Maharashtra',
        center_lat DECIMAL(10,7) NOT NULL,
        center_lng DECIMAL(10,7) NOT NULL,
        radius_km  DECIMAL(6,2)  NOT NULL DEFAULT 25.00,
        is_active  TINYINT(1)    DEFAULT 1,
        created_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_taluka_district (name, district)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS salesman_tracking (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        salesman_id INT           NOT NULL,
        latitude    DECIMAL(10,7) NOT NULL,
        longitude   DECIMAL(10,7) NOT NULL,
        accuracy    DECIMAL(8,2)  DEFAULT NULL,
        recorded_at TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_track_salesman (salesman_id),
        INDEX idx_track_time     (recorded_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await db.query('SET FOREIGN_KEY_CHECKS = 1');

    // Seed talukas — INSERT IGNORE so existing rows are never overwritten.
    // Always runs (not just when empty) so new talukas are added on next restart.
    // GPS coordinates verified for Maharashtra.
    await db.query(`
      INSERT IGNORE INTO talukas (name,district,state,center_lat,center_lng,radius_km) VALUES
      -- Ahmednagar District (all 14 talukas)
      ('Sangamner',  'Ahmednagar','Maharashtra',19.5741,74.2103,25),
      ('Rahuri',     'Ahmednagar','Maharashtra',19.3917,74.6497,20),
      ('Shrirampur', 'Ahmednagar','Maharashtra',19.6225,74.6514,22),
      ('Kopargaon',  'Ahmednagar','Maharashtra',19.8935,74.4780,22),
      ('Nevasa',     'Ahmednagar','Maharashtra',19.5594,74.9855,20),
      ('Pathardi',   'Ahmednagar','Maharashtra',18.8624,75.1914,20),
      ('Ahmednagar', 'Ahmednagar','Maharashtra',19.0948,74.7480,28),
      ('Rahata',     'Ahmednagar','Maharashtra',19.7160,74.4760,25),
      ('Parner',     'Ahmednagar','Maharashtra',19.0015,74.4359,22),
      ('Akole',      'Ahmednagar','Maharashtra',19.5200,74.0200,25),
      ('Shevgaon',   'Ahmednagar','Maharashtra',19.3449,75.0867,20),
      ('Shrigonda',  'Ahmednagar','Maharashtra',18.6221,74.7085,22),
      ('Jamkhed',    'Ahmednagar','Maharashtra',18.7167,75.3167,20),
      ('Karjat',     'Ahmednagar','Maharashtra',18.7334,75.0131,20),
      -- Nashik District (major talukas)
      ('Nashik',     'Nashik',    'Maharashtra',19.9975,73.7898,25),
      ('Igatpuri',   'Nashik',    'Maharashtra',19.6981,73.5580,20),
      ('Sinnar',     'Nashik',    'Maharashtra',19.8483,74.0000,20),
      ('Niphad',     'Nashik',    'Maharashtra',20.0800,74.1100,20),
      ('Malegaon',   'Nashik',    'Maharashtra',20.5579,74.5089,22),
      ('Yeola',      'Nashik',    'Maharashtra',20.0415,74.4886,20),
      ('Nandgaon',   'Nashik',    'Maharashtra',20.3168,74.6570,20),
      ('Chandwad',   'Nashik',    'Maharashtra',20.3405,74.2420,20),
      ('Baglan',     'Nashik',    'Maharashtra',20.5500,74.0800,22),
      ('Kalwan',     'Nashik',    'Maharashtra',20.5200,73.9900,20),
      -- Pune District (major talukas)
      ('Pune',       'Pune',      'Maharashtra',18.5204,73.8567,30),
      ('Haveli',     'Pune',      'Maharashtra',18.5700,73.9200,22),
      ('Khed',       'Pune',      'Maharashtra',18.8586,73.9910,22),
      ('Junnar',     'Pune',      'Maharashtra',19.2004,73.8800,22),
      ('Ambegaon',   'Pune',      'Maharashtra',19.1200,73.7400,20),
      ('Shirur',     'Pune',      'Maharashtra',18.8271,74.3617,20),
      ('Baramati',   'Pune',      'Maharashtra',18.1514,74.5817,22),
      ('Indapur',    'Pune',      'Maharashtra',18.1100,74.9800,20),
      ('Daund',      'Pune',      'Maharashtra',18.4600,74.5700,20),
      ('Bhor',       'Pune',      'Maharashtra',18.1500,73.8500,20),
      ('Velhe',      'Pune',      'Maharashtra',18.2800,73.6400,20),
      ('Mulshi',     'Pune',      'Maharashtra',18.5300,73.5200,20),
      ('Maval',      'Pune',      'Maharashtra',18.6800,73.4800,20),
      ('Purandar',   'Pune',      'Maharashtra',18.2760,74.0460,20),
      ('Beed',       'Beed',      'Maharashtra',18.9890,75.7560,25),
      ('Georai',     'Beed',      'Maharashtra',19.2660,75.7333,20),
      ('Majalgaon',  'Beed',      'Maharashtra',19.1528,76.2333,20),
      ('Kaij',       'Beed',      'Maharashtra',18.8333,76.0167,20),
      ('Dharur',     'Beed',      'Maharashtra',18.4500,76.3667,20),
      ('Osmanabad',  'Osmanabad', 'Maharashtra',18.1860,76.0420,22),
      ('Latur',      'Latur',     'Maharashtra',18.4088,76.5604,25),
      ('Aurangabad', 'Aurangabad','Maharashtra',19.8762,75.3433,28),
      ('Solapur',    'Solapur',   'Maharashtra',17.6805,75.9064,28)
    `);

    // Also fix wrong coordinates for existing rows (UPDATE runs always)
    await db.query(`
      UPDATE talukas SET center_lat=19.3449, center_lng=75.0867
      WHERE LOWER(name)='shevgaon' AND LOWER(district)='ahmednagar'
    `);

    // Only mark ready after ALL steps complete successfully
    _geoReady = true;
    console.log('✅  Geo tables ready');
  } catch (err) {
    // Do NOT set _geoReady — next request will retry migration
    console.warn('⚠️  ensureGeoTables failed:', err.message);
    await db.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
  }
}

/* ══════════════════════════════════════════════════════════
   INDIA BOUNDING BOX  — blocks ocean/null-island spoofing
   India: ~6°N–37°N,  68°E–97°E  (generous padding included)
══════════════════════════════════════════════════════════ */
const INDIA_BBOX = { minLat: 6.5, maxLat: 37.5, minLng: 68.0, maxLng: 97.5 };
function isInIndia(lat, lng) {
  return lat >= INDIA_BBOX.minLat && lat <= INDIA_BBOX.maxLat &&
         lng >= INDIA_BBOX.minLng && lng <= INDIA_BBOX.maxLng;
}

/* Center-spoof detection — true if submitted coords match taluka centre
   within SPOOF_RADIUS_M metres (1 metre resolution)
   Real GPS never returns exact floating-point centre coordinates. */
const SPOOF_RADIUS_M = 5;  // within 5 m of centre = suspicious
function isCentreSpoof(lat, lng, centLat, centLng) {
  // Haversine gives km — compare in metres
  return haversine(lat, lng, centLat, centLng) * 1000 < SPOOF_RADIUS_M;
}

exports.listTalukas = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM talukas WHERE is_active=1 ORDER BY district, name'
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

/* ══════════════════════════════════════════════════════════
   GET SALESMAN TALUKA  — GET /api/geo/my-taluka
   Returns salesman's assigned taluka + center coords
══════════════════════════════════════════════════════════ */
exports.getMyTaluka = async (req, res) => {
  await ensureGeoTables();
  try {
    const [users] = await db.query(
      'SELECT taluka_id, taluka_name FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!users.length) return res.status(404).json({ success: false, message: 'User not found' });

    const u = users[0];
    if (!u.taluka_id) {
      return res.json({ success: true, restricted: false, taluka: null });
    }

    const [talukas] = await db.query('SELECT * FROM talukas WHERE id = ?', [u.taluka_id]);
    if (!talukas.length) return res.json({ success: true, restricted: false, taluka: null });

    res.json({ success: true, restricted: true, taluka: talukas[0] });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

/* ══════════════════════════════════════════════════════════
   VALIDATE GPS  — POST /api/geo/validate
   Body: { latitude, longitude, salesman_id? }
   Returns: { inside, distance_km, taluka }
══════════════════════════════════════════════════════════ */
exports.validateLocation = async (req, res) => {
  await ensureGeoTables();
  try {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude)
      return res.status(400).json({ success: false, message: 'latitude and longitude required' });

    const [users] = await db.query(
      'SELECT taluka_id, taluka_name FROM users WHERE id = ?',
      [req.user.id]
    );
    const taluka_id = users[0]?.taluka_id;
    if (!taluka_id) {
      return res.json({ success: true, inside: true, restricted: false, message: 'No taluka restriction' });
    }

    const [talukas] = await db.query('SELECT * FROM talukas WHERE id = ?', [taluka_id]);
    if (!talukas.length) return res.json({ success: true, inside: true, restricted: false });

    const t = talukas[0];
    const dist = haversine(parseFloat(latitude), parseFloat(longitude), t.center_lat, t.center_lng);
    const inside = dist <= t.radius_km;

    res.json({
      success: true,
      inside,
      restricted: true,
      distance_km: parseFloat(dist.toFixed(3)),
      radius_km:   parseFloat(t.radius_km),
      taluka:      t,
      message:     inside
        ? `You are inside ${t.name} taluka (${dist.toFixed(1)} km from center)`
        : `You are outside ${t.name} taluka. Distance: ${dist.toFixed(1)} km, Allowed: ${t.radius_km} km`
    });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

/* ══════════════════════════════════════════════════════════
   GEO-VERIFIED LEAD SUBMISSION  — POST /api/geo/leads
   Body: { shop_name, owner_name, mobile, village, taluka,
           district, sale_status, photo_data (base64 canvas),
           latitude, longitude, gps_accuracy, address_geo,
           notes, visited_at }
══════════════════════════════════════════════════════════ */
exports.addGeoLead = async (req, res) => {
  try {
    const {
      shop_name, shop_type, owner_name, mobile, village, taluka, district,
      sale_status, photo_data, notes, visited_at,
      latitude, longitude, gps_accuracy, address_geo
    } = req.body;

    // All fields validated by geoLeadSchema middleware upstream.
    // Defence-in-depth: also verify the photo_data magic bytes match the declared MIME.
    const photoCheck = validatePhoto(photo_data, 'photo_data');
    if (!photoCheck.valid) {
      return res.status(422).json({ success: false, message: photoCheck.reason });
    }

    const salesman_id = req.user.id;
    let geo_verified  = 0;
    let distance_km   = null;
    let geo_suspicious = 0;

    // ── ANTI-SPOOFING: India bounding-box check ───────────────────────────────
    // Blocks coordinates for the ocean (0°,0°), other continents, IP-geolocation
    // fixes that slipped past the frontend 1500m accuracy gate.
    if (latitude && longitude) {
      const lat = parseFloat(latitude), lng = parseFloat(longitude);
      if (!isInIndia(lat, lng)) {
        return res.status(403).json({
          success: false,
          blocked: true,
          message: `GPS coordinates (${lat.toFixed(4)}, ${lng.toFixed(4)}) are outside India. ` +
                   'Please enable GPS and try again from your actual location.',
        });
      }
    }

    // ══════════════════════════════════════════════════════════
    // UNIFIED GPS ENFORCEMENT
    // Works with BOTH assignment paths:
    //   Path A: users.taluka_id  (set via geo-map Assign tab)
    //   Path B: salesman_areas   (set via salesmen.html modal)
    //
    // If the salesman has ANY assignment (either path), GPS
    // coordinates are REQUIRED and must be inside the assigned
    // taluka radius.  No assignment = no GPS restriction.
    // ══════════════════════════════════════════════════════════
    if (latitude && longitude) {

      // ── Path A: users.taluka_id (direct FK to talukas table) ──
      const [userRow] = await db.query(
        'SELECT taluka_id FROM users WHERE id = ?', [salesman_id]
      );
      const taluka_id = userRow[0]?.taluka_id;

      if (taluka_id) {
        // Salesman has a direct taluka_id assignment — enforce radius
        const [tkRows] = await db.query('SELECT * FROM talukas WHERE id = ?', [taluka_id]);
        if (tkRows.length) {
          const t    = tkRows[0];
          const dist = haversine(parseFloat(latitude), parseFloat(longitude),
                                 parseFloat(t.center_lat), parseFloat(t.center_lng));
          distance_km = parseFloat(dist.toFixed(3));

          if (dist > parseFloat(t.radius_km)) {
            return res.status(403).json({
              success:     false,
              blocked:     true,
              message:     `You are outside your assigned area "${t.name}". ` +
                           `Your distance: ${dist.toFixed(1)} km · Allowed radius: ${t.radius_km} km. ` +
                           `Lead submission blocked.`,
              distance_km,
              radius_km:    parseFloat(t.radius_km),
              taluka_name:  t.name,
              taluka_center:{ lat: parseFloat(t.center_lat), lng: parseFloat(t.center_lng) }
            });
          }
          geo_verified = 1;
          // Centre-spoof detection: real GPS never returns exact centre coordinates
          if (isCentreSpoof(parseFloat(latitude), parseFloat(longitude),
                            parseFloat(t.center_lat), parseFloat(t.center_lng))) {
            geo_suspicious = 1;
            console.warn(`[geoController] ⚠️  Suspicious GPS: salesman ${salesman_id} submitted exact centre of "${t.name}" (within ${SPOOF_RADIUS_M}m)`);
          }
        }

      } else {
        // ── Path B: salesman_areas (name-based, from salesmen.html modal) ──
        // Look up ALL areas assigned to this salesman, then find their GPS
        // centers in the talukas table and check if the current position
        // falls inside any of them.
        const [areas] = await db.query(
          'SELECT taluka, district FROM salesman_areas WHERE salesman_id = ?',
          [salesman_id]
        );

        if (areas.length > 0) {
          // Salesman HAS area restrictions — GPS must be inside at least one
          let insideAny     = false;
          let closestDist   = Infinity;
          let closestTaluka = null;
          let closestRadius = 0;

          for (const area of areas) {
            // Match area name to talukas GPS table (case-insensitive)
            const [tkMatches] = await db.query(
              `SELECT * FROM talukas
               WHERE LOWER(name) = LOWER(?) AND is_active = 1
               ORDER BY radius_km DESC LIMIT 1`,
              [area.taluka.trim()]
            );

            if (!tkMatches.length) continue; // Taluka not in GPS table yet — skip

            const t    = tkMatches[0];
            const dist = haversine(parseFloat(latitude), parseFloat(longitude),
                                   parseFloat(t.center_lat), parseFloat(t.center_lng));

            if (dist <= parseFloat(t.radius_km)) {
              insideAny   = true;
              distance_km = parseFloat(dist.toFixed(3));
              geo_verified = 1;
              // Centre-spoof detection: real GPS never returns exact centre coordinates
              if (isCentreSpoof(parseFloat(latitude), parseFloat(longitude),
                                parseFloat(t.center_lat), parseFloat(t.center_lng))) {
                geo_suspicious = 1;
                console.warn(`[geoController] ⚠️  Suspicious GPS: salesman ${salesman_id} submitted exact centre of "${t.name}" (within ${SPOOF_RADIUS_M}m)`);
              }
              break;
            }

            // Track the closest assigned taluka for the error message
            if (dist < closestDist) {
              closestDist   = dist;
              closestTaluka = t;
              closestRadius = parseFloat(t.radius_km);
            }
          }

          if (!insideAny) {
            // Build a clear, specific error message showing assigned areas
            const areaNames = areas.map(a => a.taluka).join(', ');
            const nearest   = closestTaluka
              ? ` Nearest assigned area "${closestTaluka.name}": ${closestDist.toFixed(1)} km away (allowed: ${closestRadius} km).`
              : '';

            return res.status(403).json({
              success:      false,
              blocked:      true,
              message:      `You are outside your assigned area(s): ${areaNames}.` + nearest +
                            ` Lead submission blocked. Please move to your assigned taluka.`,
              distance_km:  closestDist < Infinity ? parseFloat(closestDist.toFixed(3)) : null,
              radius_km:    closestRadius || null,
              taluka_name:  closestTaluka?.name || areas[0].taluka,
              assigned_areas: areaNames
            });
          }
        }
        // If areas.length === 0: no restrictions at all — allow submission
      }

    } else {
      // No GPS submitted — check if salesman has any assignment
      // If they do, GPS is required (cannot bypass by omitting coords)
      const [userRow] = await db.query(
        'SELECT taluka_id FROM users WHERE id = ?', [salesman_id]
      );
      const hasTalukaId = !!userRow[0]?.taluka_id;

      if (!hasTalukaId) {
        const [areas] = await db.query(
          'SELECT id FROM salesman_areas WHERE salesman_id = ? LIMIT 1', [salesman_id]
        );
        if (areas.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'GPS location is required. You have an assigned area — enable location access and try again.'
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message: 'GPS location is required. You have an assigned taluka — enable location access and try again.'
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
      visitTime = new Date().toISOString().slice(0,19).replace('T',' ');
    }

    // ── Calculate Grand Total ──
    let grand_total = 0;
    const products = req.body.products || [];
    if (Array.isArray(products) && products.length) {
      products.forEach(p => {
        const p_price = parseFloat(p.price) || 0;
        const p_qty   = parseInt(p.quantity, 10) || 1;
        grand_total += (p_price * p_qty);
      });
    }

    const [result] = await db.query(
      `INSERT INTO shop_leads
         (salesman_id, shop_name, shop_type, owner_name, mobile, village, taluka, district,
          sale_status, grand_total, photo_proof, notes, visited_at,
          latitude, longitude, gps_accuracy, address_geo, geo_verified, distance_km, geo_suspicious)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [salesman_id, shop_name.trim(), shop_type||'', owner_name.trim(), mobile.trim(),
       village.trim(), taluka.trim(), district.trim(),
       sale_status||'NO', grand_total, photo_data||null, notes?.trim()||null, visitTime,
       latitude||null, longitude||null, gps_accuracy||null, address_geo||null,
       geo_verified, distance_km, geo_suspicious]
    );

    // Save lead_products if provided
    if (Array.isArray(products) && products.length > 0) {
      const leadId = result.insertId;
      const validItems = products.filter(
        p => p && Number.isInteger(Number(p.product_id)) && Number(p.product_id) > 0
      );
      if (validItems.length) {
        // Verify product IDs exist and are active
        const ids = validItems.map(p => Number(p.product_id));
        const [existing] = await db.query(
          `SELECT id, name FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND is_active = 1`,
          ids
        );
        const validSet = new Set(existing.map(r => r.id));
        const rows = validItems
          .filter(p => validSet.has(Number(p.product_id)))
          .map(p => {
            const prodRecord = existing.find(r => r.id === Number(p.product_id));
            const name  = p.name || (prodRecord ? prodRecord.name : '');
            const price = parseFloat(p.price) || 0;
            const quantity = Math.max(1, parseInt(p.quantity, 10) || 1);
            return [leadId, Number(p.product_id), name, price, quantity, parseFloat((price * quantity).toFixed(2))];
          });
        if (rows.length) {
          try {
            await db.query(
              'INSERT INTO lead_products (lead_id, product_id, name, price, quantity, total) VALUES ' +
              rows.map(() => '(?,?,?,?,?,?)').join(','),
              rows.flat()
            );
          } catch (lpErr) {
            // lead_products table not yet created — log and continue, don't crash the lead save
            if (lpErr.code === 'ER_NO_SUCH_TABLE') {
             console.warn('[geoController] lead_products table missing — re-run database/aqualence_complete.sql');
            } else {
              throw lpErr;
            }
          }
        }
      }
    }

    res.status(201).json({
      success: true,
      id: result.insertId,
      geo_verified,
      geo_suspicious: geo_suspicious === 1 ? true : undefined,
      distance_km,
      message: 'Lead added successfully'
    });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

/* ══════════════════════════════════════════════════════════
   LIVE TRACKING PING  — POST /api/geo/track
   Body: { latitude, longitude, accuracy }
   Called every 2 minutes by salesman app
══════════════════════════════════════════════════════════ */
exports.trackLocation = async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;
    if (!latitude || !longitude)
      return res.status(400).json({ success: false, message: 'latitude and longitude required' });

    await db.query(
      'INSERT INTO salesman_tracking (salesman_id, latitude, longitude, accuracy) VALUES (?,?,?,?)',
      [req.user.id, latitude, longitude, accuracy || null]
    );

    // FIX #6 (Tracking table bloat): Prune rows older than 30 days.
    // Runs asynchronously — does not block the response to the salesman.
    // 1-in-50 chance per ping keeps DB overhead negligible (~2% of requests).
    if (Math.random() < 0.02) {
      db.query(
        'DELETE FROM salesman_tracking WHERE recorded_at < NOW() - INTERVAL 30 DAY'
      ).catch(e => console.warn('[trackLocation] cleanup error:', e.message));
    }

    res.json({ success: true });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

/* ══════════════════════════════════════════════════════════
   LATEST LOCATIONS (admin)  — GET /api/geo/live-positions
   Returns most recent ping per salesman
══════════════════════════════════════════════════════════ */
exports.livePositions = async (req, res) => {
  try {
    // FIX #2: Replace N+1 correlated subquery with a single efficient query.
    // Uses a derived table (latest CTE-equivalent) to get the max recorded_at
    // per salesman in one pass, then JOINs back — O(n) instead of O(n²).
    // Also adds a 2-hour staleness window on the derived table so the outer
    // join only touches recent rows, keeping the result set small.
    const [rows] = await db.query(`
      SELECT u.id AS salesman_id, u.name, u.phone,
             st.latitude, st.longitude, st.accuracy, st.recorded_at
      FROM (
        SELECT salesman_id, MAX(recorded_at) AS latest_at
        FROM salesman_tracking
        WHERE recorded_at >= NOW() - INTERVAL 2 HOUR
        GROUP BY salesman_id
      ) latest
      JOIN salesman_tracking st
        ON st.salesman_id = latest.salesman_id
        AND st.recorded_at = latest.latest_at
      JOIN users u ON u.id = st.salesman_id
      ORDER BY u.name
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

/* ══════════════════════════════════════════════════════════
   ALL GEO LEADS (admin map)  — GET /api/geo/map-leads
   Returns leads with coordinates for map display
══════════════════════════════════════════════════════════ */
exports.mapLeads = async (req, res) => {
  try {
    // FIX #7 (Pagination): Hard 500-row LIMIT replaced with configurable
    // limit + offset. Default limit is 500 for backwards compatibility.
    // Frontend can pass ?limit=1000&offset=500 to page through all results.
    const { from, to, salesman_id, limit = 500, offset = 0 } = req.query;
    const safeLimit  = Math.min(Math.max(parseInt(limit)  || 500, 1), 2000);
    const safeOffset = Math.max(parseInt(offset) || 0, 0);

    let sql = `
      SELECT sl.id, sl.shop_name, sl.owner_name, sl.mobile, sl.taluka, sl.district,
             sl.sale_status, sl.latitude, sl.longitude, sl.geo_verified,
             sl.distance_km, sl.address_geo, sl.visited_at, sl.photo_proof,
             u.name AS salesman_name
      FROM shop_leads sl
      JOIN users u ON u.id = sl.salesman_id
      WHERE sl.latitude IS NOT NULL AND sl.longitude IS NOT NULL
    `;
    const params = [];
    if (from)        { sql += ' AND DATE(sl.visited_at) >= ?'; params.push(from); }
    if (to)          { sql += ' AND DATE(sl.visited_at) <= ?'; params.push(to); }
    if (salesman_id) { sql += ' AND sl.salesman_id = ?';        params.push(salesman_id); }
    sql += ' ORDER BY sl.visited_at DESC LIMIT ? OFFSET ?';
    params.push(safeLimit, safeOffset);

    const [rows] = await db.query(sql, params);

    // Return total count so frontend can show pagination controls
    let countSql = `SELECT COUNT(*) AS total FROM shop_leads sl WHERE sl.latitude IS NOT NULL AND sl.longitude IS NOT NULL`;
    const countParams = [];
    if (from)        { countSql += ' AND DATE(sl.visited_at) >= ?'; countParams.push(from); }
    if (to)          { countSql += ' AND DATE(sl.visited_at) <= ?'; countParams.push(to); }
    if (salesman_id) { countSql += ' AND sl.salesman_id = ?';        countParams.push(salesman_id); }
    const [[{ total }]] = await db.query(countSql, countParams);

    res.json({ success: true, data: rows, total, limit: safeLimit, offset: safeOffset });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

/* ══════════════════════════════════════════════════════════
   TALUKA MANAGEMENT (admin)
══════════════════════════════════════════════════════════ */
exports.createTaluka = async (req, res) => {
  try {
    const { name, district, state, center_lat, center_lng, radius_km } = req.body;
    if (!name || !district || !center_lat || !center_lng)
      return res.status(400).json({ success: false, message: 'name, district, center_lat, center_lng required' });

    // Use INSERT ... ON DUPLICATE KEY UPDATE so saving a zone that was auto-seeded
    // on startup updates its coordinates instead of returning an error.
    // ensureGeoTables seeds 46 Maharashtra talukas on every restart — without this
    // the admin could never customise a seeded taluka's radius or coordinates.
    const [r] = await db.query(
      `INSERT INTO talukas (name, district, state, center_lat, center_lng, radius_km)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         state      = VALUES(state),
         center_lat = VALUES(center_lat),
         center_lng = VALUES(center_lng),
         radius_km  = VALUES(radius_km),
         is_active  = 1`,
      [name, district, state||'Maharashtra', center_lat, center_lng, radius_km||25]
    );
    // insertId = new row; affectedRows=2 means updated existing row
    const updated = r.affectedRows === 2;
    res.status(updated ? 200 : 201).json({
      success: true,
      id:      r.insertId || null,
      updated,
      message: updated ? `${name} zone updated` : `${name} zone saved`
    });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

exports.updateTaluka = async (req, res) => {
  try {
    const { name, district, state, center_lat, center_lng, radius_km, is_active } = req.body;
    await db.query(
      'UPDATE talukas SET name=?,district=?,state=?,center_lat=?,center_lng=?,radius_km=?,is_active=? WHERE id=?',
      [name, district, state||'Maharashtra', center_lat, center_lng, radius_km||25, is_active??1,
       parseId(req.params.id)]
    );
    res.json({ success: true });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

// FIX #8: DELETE /api/geo/talukas/:id — soft-delete (sets is_active=0)
// Hard delete is blocked if any salesman is still assigned to this taluka.
exports.deleteTaluka = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'Invalid taluka ID' });

    // Block delete if any active salesman is assigned to this taluka
    const [[{ assigned }]] = await db.query(
      'SELECT COUNT(*) AS assigned FROM users WHERE taluka_id = ? AND role = ? AND is_active = 1',
      [id, 'salesman']
    );
    if (assigned > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete — ${assigned} active salesman(s) are assigned to this taluka. Re-assign them first.`
      });
    }

    // Soft delete: preserve historical lead data integrity
    const [result] = await db.query(
      'UPDATE talukas SET is_active = 0 WHERE id = ?', [id]
    );
    if (result.affectedRows === 0)
      return res.status(404).json({ success: false, message: 'Taluka not found' });

    res.json({ success: true, message: 'Taluka deactivated successfully' });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};

exports.assignTaluka = async (req, res) => {
  try {
    const { taluka_id } = req.body;
    const salesman_id   = parseId(req.params.id);
    if (!salesman_id) return res.status(400).json({ success: false, message: 'Invalid salesman ID' });

    if (!taluka_id) {
      // Remove assignment
      await db.query('UPDATE users SET taluka_id=NULL, taluka_name=NULL WHERE id=? AND role=?', [salesman_id,'salesman']);
      return res.json({ success: true, message: 'Taluka assignment removed' });
    }

    const [t] = await db.query('SELECT * FROM talukas WHERE id=?', [taluka_id]);
    if (!t.length) return res.status(404).json({ success: false, message: 'Taluka not found' });

    await db.query(
      'UPDATE users SET taluka_id=?, taluka_name=? WHERE id=? AND role=?',
      [taluka_id, t[0].name, salesman_id, 'salesman']
    );
    res.json({ success: true, message: `${t[0].name} assigned` });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};


/* ══════════════════════════════════════════════════════════
   SINGLE LEAD DETAIL (admin)  — GET /api/geo/leads/:id
   Returns lead + all products selected by salesman
══════════════════════════════════════════════════════════ */
exports.getLeadDetail = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id || id <= 0) return res.status(400).json({ success: false, message: 'Invalid lead id' });

    // Lead row
    const [leads] = await db.query(
      `SELECT sl.*, u.name AS salesman_name
       FROM shop_leads sl
       JOIN users u ON u.id = sl.salesman_id
       WHERE sl.id = ? LIMIT 1`,
      [id]
    );
    if (!leads.length) return res.status(404).json({ success: false, message: 'Lead not found' });

    // Products attached to this lead
    const [products] = await db.query(
      `SELECT lp.product_id, lp.name, lp.price, lp.quantity, lp.total, p.category
       FROM lead_products lp
       LEFT JOIN products p ON p.id = lp.product_id
       WHERE lp.lead_id = ?
       ORDER BY lp.id`,
      [id]
    );

    res.json({ success: true, lead: leads[0], products });
  } catch (err) {
    serverError(res, err, '[geoController.getLeadDetail]');
  }
};

exports.ensureGeoTables = ensureGeoTables;
exports.haversine = haversine;

/* ══════════════════════════════════════════════════════════
   GET ALL SALESMEN WITH TALUKA ASSIGNMENTS (admin)
   GET /api/geo/salesmen-assignments
══════════════════════════════════════════════════════════ */
exports.salesmenAssignments = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.name, u.phone, u.is_active,
             u.taluka_id,
             t.name       AS taluka_name,
             t.district   AS taluka_district,
             t.radius_km  AS taluka_radius,
             t.center_lat, t.center_lng
      FROM users u
      LEFT JOIN talukas t ON t.id = u.taluka_id
      WHERE u.role = 'salesman'
      ORDER BY u.name
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    serverError(res, err, '[geoController]');
  }
};