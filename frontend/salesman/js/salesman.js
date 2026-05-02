'use strict';

function _esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str != null ? String(str) : ''));
  return d.innerHTML;
}

/* ══════════════════════════════════════════════════════════════
   salesman.js — FIXED
   Fixes: loadLeads targets correct element, robust apiFetch,
   proper error states, no silent null-returns
══════════════════════════════════════════════════════════════ */
const API = '/api/v1';

/* ── Auth helpers ─────────────────────────────────────────── */
// Fix 2: Token is in httpOnly cookie — JS cannot read it.
// User profile stored in sessionStorage for fast UX checks only.
function getSalesUser() {
  try { return JSON.parse(sessionStorage.getItem('aq_sales_user') || 'null'); }
  catch { return null; }
}

// Rehydrate sessionStorage from server if tab was closed/reopened.
async function salesAuthRehydrate() {
  // Auth gate in network.js handles rehydration — just wait for it
  if (window._aqAuthReady) await window._aqAuthReady.catch(function(){});
  return !!getSalesUser();
}

function authHeader() {
  // Send Bearer token as fallback for mobile browsers that block cross-site cookies
  const token = localStorage.getItem('aq_token');
  return token
    ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
    : { 'Content-Type': 'application/json' };
}
var _salesLoggingOut = false;
async function salesLogout() {
  if (_salesLoggingOut) return;
  _salesLoggingOut = true;
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (_) { /* best-effort */ }
  sessionStorage.removeItem('aq_sales_user');
  try { localStorage.removeItem('aq_token'); } catch(_){}
  window.location.replace('login.html');
}
function salesmanLogout() { salesLogout(); }
window.salesLogout = salesLogout;
window.salesAuthRehydrate = salesAuthRehydrate;

/* ── Fetch wrapper ────────────────────────────────────────── */
/* FIX: wraps network errors + auth expiry in one place       */
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: { ...authHeader(), ...(options.headers || {}) }
    });
    // 401/403 handled centrally by network.js patchApiFetch — do not duplicate here
    return res;
  } catch (err) {
    if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
      throw new Error('Network error. Check your connection.');
    }
    throw err;
  }
}

/* Safe JSON parse from a fetch response */
async function safeJson(res) {
  try { return await res.json(); }
  catch (e) { throw new Error('Server returned invalid data.'); }
}

/* ── Toast ────────────────────────────────────────────────── */
function showToast(msg, type, duration) {
  type     = type     || 'default';
  duration = duration || 3500;
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), duration);
}

/* ── Modals ───────────────────────────────────────────────── */
function openModal(id) { document.getElementById(id)?.classList.add('show'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('show'); }

/* ── Sidebar toggle ──────────────────────────────────────── */
function toggleSidebar() { const el = document.getElementById('sidebar'); if (el) el.classList.toggle('open'); }

/* ── Formatters ───────────────────────────────────────────── */
const page = window.location.pathname.split('/').pop().replace('.html','');

function fmtDT(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}
function todayStr()  { return new Date().toISOString().slice(0,10); }
function monthStart(){ const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-01'; }
function weekStart() { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0,10); }

/* ── Spinner HTML helper ─────────────────────────────────── */
function spinnerRow(cols, msg) {
  msg = msg || '';
  return '<tr><td colspan="' + cols + '" style="text-align:center;padding:40px">'
    + (msg ? '<div style="color:var(--ink-soft);font-size:.85rem">' + msg + '</div>'
           : '<div class="spinner"></div>')
    + '</td></tr>';
}

/* ══════════════════════════════════════════════════════════════
   PAGE: LOGIN
══════════════════════════════════════════════════════════════ */
if (page === 'login') {
  if (getSalesUser()) window.location.replace('dashboard.html');  // fast UX redirect

  const loginForm = document.getElementById('salesmanLoginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      const err = document.getElementById('loginError');
      const btn = document.getElementById('loginBtn');
      if (err) err.classList.add('hidden');
      btn.textContent = 'Logging in…'; btn.disabled = true;
      try {
        const res  = await fetch(API + '/auth/login', {
          method:      'POST',
          credentials: 'include',
          headers:     { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone:    document.getElementById('phone').value.trim(),
            password: document.getElementById('password').value
          })
        });
        const data = await safeJson(res);
        if (!data.success) throw new Error(data.message);

        if (data.mfa_required) {
          throw new Error('Multi-factor authentication required. Please complete MFA or contact your administrator.');
        }
        if (data.otp_required) {
          throw new Error('SMS OTP required. Please complete OTP or contact your administrator.');
        }

        if (!data.user) throw new Error('Login response missing user profile.');
        if (data.user.role !== 'salesman') throw new Error('This portal is for field salesmen only.');

        // Store token for cross-site Bearer auth (mobile browsers block httpOnly cookies cross-origin)
        if (data.token) { try { localStorage.setItem('aq_token', data.token); } catch(_){} }
        // Fix 2: Token is in httpOnly cookie — store only the user profile
        sessionStorage.setItem('aq_sales_user', JSON.stringify(data.user));
        // Fix 4: Force password change if required
        if (data.user.must_change_password) {
          window.location.replace('change-password.html');
          return;
        }
        window.location.replace('dashboard.html');
      } catch (ex) {
        if (err) { err.textContent = ex.message; err.classList.remove('hidden'); }
        btn.textContent = 'Login to Field App'; btn.disabled = false;
      }
    });
  }
}

/* ══════════════════════════════════════════════════════════════
   AUTHENTICATED PAGES — common setup
══════════════════════════════════════════════════════════════ */
if (page !== 'login') {
  salesAuthRehydrate().then(function(ok) {
    if (!ok) return;
    const u  = getSalesUser();
    const el = document.getElementById('sidebarName');
    if (el && u) el.textContent = u.name;

    // Close modals on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.classList.remove('show');
      });
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   PAGE: DASHBOARD
══════════════════════════════════════════════════════════════ */
var allLeads = [];
var _myAreas = [];   // assigned talukas for this salesman

/* ══════════════════════════════════════════════════════════════
   PRODUCT SELECTOR — Dropdown + Table
══════════════════════════════════════════════════════════════ */
var _psAllProducts = [];   // full product list from API
var _psSelected    = [];   // [{ product_id, variant_id, name, price, dist_price, quantity, total }]

/* ── Load products+variants into grouped dropdown ─────────────── */
async function loadProductsDropdown() {
  var sel = document.getElementById('psDropdown');
  if (!sel) return;
  if (_psAllProducts.length) { _psRebuildDropdown(); return; }
  sel.innerHTML = '<option value="">Loading…</option>';
  try {
    var res  = await apiFetch(API + '/products');
    var json = await safeJson(res);
    if (!json.success) throw new Error(json.message || 'Failed');
    var products = (json.data || []).filter(function(p){ return p.is_active !== 0; });
    // Fetch variants for each product
    var withVariants = await Promise.all(products.map(async function(p) {
      try {
        var vr   = await apiFetch(API + '/products/' + p.id + '/variants');
        var vj   = await safeJson(vr);
        p.variants = (vj.data || []).filter(function(v){ return v.is_active !== 0; });
      } catch(e) { p.variants = []; }
      return p;
    }));
    _psAllProducts = withVariants;
    _psRebuildDropdown();
  } catch (e) {
    sel.innerHTML = '<option value="">⚠ Could not load products</option>';
    console.warn('[loadProductsDropdown]', e.message);
  }
}

/* ── Rebuild grouped dropdown ─────────────────────────────────── */
function _psRebuildDropdown() {
  var sel = document.getElementById('psDropdown');
  if (!sel) return;
  // track added as "pid_vid" or "pid_" for base
  var addedKeys = new Set(_psSelected.map(function(p){
    return p.product_id + '_' + (p.variant_id || '');
  }));
  sel.innerHTML = '<option value="">— Select product / variant —</option>';
  _psAllProducts.forEach(function(p) {
    if (p.variants && p.variants.length > 0) {
      // grouped: base product + variants under optgroup
      var grp = document.createElement('optgroup');
      grp.label = p.name;
      // base product first
      var baseKey = p.id + '_';
      var baseOpt = document.createElement('option');
      baseOpt.value = baseKey;
      baseOpt.textContent = '(Base) ' + p.name + (p.unit ? ' (' + p.unit + ')' : '') + ' — ₹' + parseFloat(p.price || 0).toFixed(0)
        + (p.distributor_price ? '  (Dist ₹' + parseFloat(p.distributor_price).toFixed(0) + ')' : '');
      if (addedKeys.has(baseKey)) baseOpt.disabled = true;
      grp.appendChild(baseOpt);
      // variants
      p.variants.forEach(function(v) {
        var key = p.id + '_' + v.id;
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = v.variant_name + ' — ₹' + parseFloat(v.price || 0).toFixed(0)
          + (v.distributor_price ? '  (Dist ₹' + parseFloat(v.distributor_price).toFixed(0) + ')' : '');
        if (addedKeys.has(key)) opt.disabled = true;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    } else {
      // Base product (no variants)
      var key = p.id + '_';
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = p.name + (p.unit ? ' (' + p.unit + ')' : '') + ' — ₹' + parseFloat(p.price || 0).toFixed(0)
        + (p.distributor_price ? '  (Dist ₹' + parseFloat(p.distributor_price).toFixed(0) + ')' : '');
      if (addedKeys.has(key)) opt.disabled = true;
      sel.appendChild(opt);
    }
  });
}

/* ── Add selected product/variant to table ────────────────────── */
function psAddProduct() {
  var sel = document.getElementById('psDropdown');
  if (!sel || !sel.value) return;
  var parts      = sel.value.split('_');
  var pid        = parseInt(parts[0], 10);
  var vid        = parts[1] ? parseInt(parts[1], 10) : null;
  var product    = _psAllProducts.find(function(p){ return p.id === pid; });
  if (!product) { sel.value = ''; return; }

  var key = pid + '_' + (vid || '');
  if (_psSelected.some(function(p){ return (p.product_id + '_' + (p.variant_id||'')) === key; })) {
    showToast('Already added.', 'error'); sel.value = ''; return;
  }

  var variant    = vid ? (product.variants || []).find(function(v){ return v.id === vid; }) : null;
  var label      = variant ? product.name + ' — ' + variant.variant_name : product.name;
  var price      = parseFloat(variant ? variant.price : product.price) || 0;
  var dist_price = variant
    ? (parseFloat(variant.distributor_price) || null)
    : (parseFloat(product.distributor_price) || null);

  _psSelected.push({
    product_id: pid,
    variant_id: vid || null,
    name: label,
    price: price,
    dist_price: dist_price,
    quantity: 1,
    total: price
  });
  sel.value = '';
  _psRenderTable();
  _psRebuildDropdown();
  _psClearError();
  showToast(label + ' added ✓', 'success');
}

/* ── Render the selected-products table ─────────────────────── */
function _psRenderTable() {
  var tbody = document.getElementById('psTableBody');
  var empty = document.getElementById('psEmpty');
  var wrap  = document.getElementById('psTableWrap');
  if (!tbody) return;

  if (_psSelected.length === 0) {
    if (empty) empty.style.display = '';
    if (wrap)  wrap.style.display  = 'none';
    _psUpdateGrandTotal();
    return;
  }
  if (empty) empty.style.display = 'none';
  if (wrap)  wrap.style.display  = '';

  tbody.innerHTML = _psSelected.map(function(p, i) {
    var distBadge = p.dist_price
      ? '<div style="font-size:.66rem;color:#7b1fa2;margin-top:1px">Dist ₹' + p.dist_price.toFixed(2) + '</div>'
      : '';
    return '<tr>'
      + '<td><span class="ps-prod-name" title="' + _esc(p.name) + '">' + _esc(p.name) + '</span>' + distBadge + '</td>'
      + '<td><input type="number" class="ps-num-input" id="ps-price-' + i + '"'
      +       ' value="' + p.price.toFixed(2) + '" min="0" step="0.01" inputmode="decimal"'
      +       ' oninput="psUpdateField(' + i + ',\'price\',this.value)" /></td>'
      + '<td><input type="number" class="ps-num-input" id="ps-qty-' + i + '"'
      +       ' value="' + p.quantity + '" min="1" step="1" style="width:56px" inputmode="numeric"'
      +       ' oninput="psUpdateField(' + i + ',\'quantity\',this.value)" /></td>'
      + '<td><span class="ps-row-total" id="ps-total-' + i + '">₹' + (p.price * p.quantity).toFixed(2) + '</span></td>'
      + '<td><button type="button" class="ps-remove-btn" onclick="psRemoveRow(' + i + ')" title="Remove">✕</button></td>'
      + '</tr>';
  }).join('');
  _psUpdateGrandTotal();
}

/* ── Update price or quantity, recalculate row total ─────────── */
function psUpdateField(idx, field, val) {
  var p = _psSelected[idx];
  if (!p) return;
  if (field === 'price')    p.price    = Math.max(0, parseFloat(val)   || 0);
  if (field === 'quantity') p.quantity = Math.max(1, parseInt(val, 10) || 1);
  p.total = p.price * p.quantity;
  var el = document.getElementById('ps-total-' + idx);
  if (el) el.textContent = '₹' + p.total.toFixed(2);
  _psUpdateGrandTotal();
}

/* ── Remove a row ────────────────────────────────────────────── */
function psRemoveRow(idx) {
  _psSelected.splice(idx, 1);
  _psRenderTable();
  _psRebuildDropdown();
}

/* ── Update grand total display ─────────────────────────────── */
function _psUpdateGrandTotal() {
  var gt = _psSelected.reduce(function(s, p){ return s + (p.price * p.quantity); }, 0);
  var el = document.getElementById('psGrandTotal');
  if (el) el.textContent = '₹' + gt.toFixed(2);
}

/* ── Reset selector (called on modal open/close) ─────────────── */
function _resetProductSelector() {
  _psSelected = [];
  _psRebuildDropdown();
  _psRenderTable();
  _psClearError();
}

/* ── Error helpers ───────────────────────────────────────────── */
function _psClearError() {
  var el = document.getElementById('productSectionError');
  if (el) el.style.display = 'none';
}
function _showProductError(msg) {
  var el = document.getElementById('productSectionError');
  if (el) { el.textContent = msg; el.style.display = ''; }
}

/* ── Build API payload ───────────────────────────────────────── */
function _buildProductsPayload() {
  return _psSelected.map(function(p, i) {
    var priceEl = document.getElementById('ps-price-' + i);
    var qtyEl   = document.getElementById('ps-qty-'   + i);
    var price   = priceEl ? Math.max(0, parseFloat(priceEl.value) || 0) : p.price;
    var qty     = qtyEl   ? Math.max(1, parseInt(qtyEl.value, 10) || 1) : p.quantity;
    return { variant_id: p.variant_id || null,
      product_id: p.product_id,
      name:       p.name,
      price:      parseFloat(price.toFixed(2)),
      quantity:   parseInt(qty, 10),
      total:      parseFloat((price * qty).toFixed(2)),
    };
  });
}
if (page === 'dashboard') {
  salesAuthRehydrate().then(function(ok) {
    if (!ok) return;
    loadMyAreas();
    loadLeads();
    loadQuickStats();
  });
}

/* ── Load my assigned areas ─────────────────────────────── */
async function loadMyAreas() {
  try {
    const res  = await apiFetch(API + '/salesman/my-areas');
    const ct   = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) return; // server error, no restriction
    const json = await safeJson(res);
    if (json.success) {
      _myAreas = json.data || [];
      if (_myAreas.length) applyAreaRestriction();
    }
  } catch(e) {
    console.warn('loadMyAreas:', e.message);
    // No restriction on error — salesman can still add leads
  }
}

/* ── Apply area restriction to the lead form ────────────── */
function applyAreaRestriction() {
  if (!_myAreas.length) return;

  const wrap = document.getElementById('talukaFieldWrap');
  if (!wrap) return;

  // Remove existing lTaluka (input or select) and replace with fresh select
  const existing = document.getElementById('lTaluka');
  if (existing) existing.remove();

  const sel = document.createElement('select');
  sel.id       = 'lTaluka';
  sel.required = true;
  sel.innerHTML =
    '<option value="">— Select Your Taluka —</option>' +
    _myAreas.map(a =>
      `<option value="${a.taluka}" data-district="${a.district}">${a.taluka}, ${a.district}</option>`
    ).join('');
  wrap.appendChild(sel);

  // Auto-fill district
  sel.addEventListener('change', function() {
    const opt = sel.options[sel.selectedIndex];
    const d   = document.getElementById('lDistrict');
    if (d && opt.dataset.district) {
      d.value = opt.dataset.district;
      d.readOnly = true;
      d.style.background = '#f5f5f5';
    }
  });

  // Lock district
  const d = document.getElementById('lDistrict');
  if (d) {
    d.readOnly    = true;
    d.placeholder = 'Auto-filled';
    d.style.background = '#f5f5f5';
    d.style.color = 'var(--ink-soft)';
  }

  // Show restriction badge
  const notice = document.getElementById('areaRestrictionNotice');
  if (notice) {
    notice.style.display = '';
    notice.innerHTML = `📍 <strong>Assigned areas:</strong> ${_myAreas.map(a => a.taluka).join(' · ')} — You can only add leads in these areas.`;
  }
}

/* ── Reset form taluka field for new lead ─────────────── */
function resetTalukaField() {
  if (_myAreas.length) {
    // Restricted — ensure select is present and reset to blank
    const sel = document.getElementById('lTaluka');
    if (sel && sel.tagName === 'SELECT') {
      sel.value = '';
    } else {
      applyAreaRestriction(); // rebuild if missing
    }
    const d = document.getElementById('lDistrict');
    if (d) { d.value = ''; }
    const notice = document.getElementById('areaRestrictionNotice');
    if (notice) notice.style.display = '';
    const block = document.getElementById('areaBlockNotice');
    if (block) block.style.display = 'none';
  } else {
    // Unrestricted — ensure plain input is present
    const existing = document.getElementById('lTaluka');
    if (existing && existing.tagName === 'SELECT') {
      // Swap back to input
      const inp = document.createElement('input');
      inp.type = 'text'; inp.id = 'lTaluka';
      inp.placeholder = 'Sangamner'; inp.required = true;
      existing.parentNode.replaceChild(inp, existing);
    } else if (existing) {
      existing.value = '';
    }
    const d = document.getElementById('lDistrict');
    if (d) { d.readOnly = false; d.style.background = ''; d.style.color = ''; d.value = ''; }
    const notice = document.getElementById('areaRestrictionNotice');
    if (notice) notice.style.display = 'none';
  }
}

async function loadQuickStats() {
  try {
    const res  = await apiFetch(API + '/salesman/report');
    const json = await safeJson(res);
    if (!json.success || !json.data) return;
    const data = json.data;

    const el1 = document.getElementById('statTodayLeads');
    const el2 = document.getElementById('statMonthLeads');
    if (el1) el1.textContent = data.today_leads  != null ? data.today_leads  : '0';
    if (el2) el2.textContent = data.month_leads   != null ? data.month_leads  : '0';

    // Legacy quickStats grid (if present on other layouts)
    const qs = document.getElementById('quickStats');
    if (qs) {
      qs.innerHTML =
        '<div class="stat-card"><div class="stat-icon">📋</div><div class="stat-label">Total Leads</div><div class="stat-value">' + data.total_leads + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon">✅</div><div class="stat-label">Sales Done</div><div class="stat-value green">' + data.yes_leads + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon">❌</div><div class="stat-label">No Sale</div><div class="stat-value" style="color:var(--error)">' + data.no_leads + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon">📅</div><div class="stat-label">Today Visits</div><div class="stat-value gold">' + data.today_visits + '</div></div>' +
        '<div class="stat-card"><div class="stat-icon">🗓</div><div class="stat-label">This Month</div><div class="stat-value" style="color:var(--brand)">' + data.month_leads + '</div></div>';
    }
  } catch(e) {
    console.warn('[salesman] loadQuickStats:', e.message);
  }
}

/* ── loadLeads — FIX: targets leadsTableBody (new) OR leadsContainer (old) */
async function loadLeads() {
  /* Determine which layout is present */
  const tbody   = document.getElementById('leadsTableBody');   // new table layout
  const legacyC = document.getElementById('leadsContainer');   // old card layout

  /* Show loading state in whichever container exists */
  if (tbody) {
    tbody.innerHTML = spinnerRow(8);
  } else if (legacyC) {
    legacyC.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
  } else {
    return; // neither layout present — not on dashboard
  }

  try {
    const res  = await apiFetch(API + '/salesman/leads');
    const json = await safeJson(res);

    if (!json.success) throw new Error(json.message || 'Failed to load leads');

    allLeads = Array.isArray(json.data) ? json.data : [];
    filterLeads();

  } catch (err) {
    const msg = err.message || 'Could not load leads';
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--error)">⚠️ Failed to load leads. Please retry.'
        + ' <button class="btn btn-outline btn-sm" style="margin-left:10px" onclick="loadLeads()">Retry</button></td></tr>';
    } else if (legacyC) {
      legacyC.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load</h3>'
        + '<p>' + msg + '</p>'
        + '<button class="btn btn-outline btn-sm" style="margin-top:10px" onclick="loadLeads()">Retry</button></div>';
    }
    console.error('[salesman] loadLeads:', err.message);
  }
}

function filterLeads() {
  const q  = (document.getElementById('searchLeads')?.value || '').toLowerCase().trim();
  const st = document.getElementById('statusFilter')?.value || '';

  const filtered = allLeads.filter(function(l) {
    const matchStatus = !st || l.sale_status === st;
    const matchSearch = !q  || [l.shop_name, l.owner_name, l.village, l.taluka, l.district, l.mobile]
      .some(function(f) { return (f || '').toLowerCase().indexOf(q) !== -1; })
      || (Array.isArray(l.products) && l.products.some(function(p){ return (p.name||'').toLowerCase().indexOf(q)!==-1; }));
    return matchStatus && matchSearch;
  });

  renderLeads(filtered);
}

function renderLeads(leads) {
  const u = getSalesUser();

  /* ── New table layout (leadsTableBody) ── */
  const tbody = document.getElementById('leadsTableBody');
  if (tbody) {
    if (!leads.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--ink-soft)">No leads found. Add your first lead ➕</td></tr>';
      return;
    }
    tbody.innerHTML = leads.map(function(l, i) {
      return '<tr onclick="viewLead(' + l.id + ')" style="cursor:pointer">'
        + '<td style="color:var(--ink-soft);font-size:.78rem">' + (i + 1) + '</td>'
        + '<td><span style="font-weight:700;color:var(--brand);font-size:.82rem">' + _esc(u ? u.name : (l.salesman_name || '—')) + '</span></td>'
        + '<td><strong>' + _esc(l.shop_name) + '</strong></td>'
        + '<td style="color:var(--ink-soft);font-size:.78rem">' + _esc(l.shop_type || '—') + '</td>'
        + '<td>' + _esc(l.owner_name) + '</td>'
        + '<td><a href="tel:' + _esc(l.mobile) + '" style="color:var(--brand);font-weight:600" onclick="event.stopPropagation()">' + _esc(l.mobile) + '</a></td>'
        + '<td>' + _esc(l.village) + '</td>'
        + '<td><span class="' + (l.sale_status === 'YES' ? 'sale-yes' : 'sale-no') + '">' + l.sale_status + '</span></td>'
        + '</tr>';
    }).join('');
    return;
  }

  /* ── Legacy card layout (leadsContainer) ── */
  const c = document.getElementById('leadsContainer');
  if (!c) return;

  if (!leads.length) {
    c.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h3>No leads found</h3><p>Add your first shop lead using the + button.</p></div>';
    return;
  }

  c.innerHTML = leads.map(function(l) {
    return '<div class="lead-card ' + (l.sale_status === 'YES' ? 'yes' : 'no') + '">'
      + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">'
      +   '<div><div class="lead-shop">' + _esc(l.shop_name) + '</div>' + (l.shop_type ? '<span class="lead-type">' + _esc(l.shop_type) + '</span>' : '') + '</div>'
      +   '<div style="display:flex;gap:6px;align-items:center">'
      +   (l.photo_proof ? '<img src="' + l.photo_proof + '" class="photo-thumb" onclick="viewPhoto(' + l.id + ')" title="View photo" alt="proof" />' : '')
      +   '<span class="' + (l.sale_status === 'YES' ? 'sale-yes' : 'sale-no') + '">' + (l.sale_status === 'YES' ? '✅ SALE' : '❌ NO SALE') + '</span>'
      +   '</div></div>'
      + '<div class="lead-meta" style="font-size:.8rem;color:var(--ink-soft);line-height:1.7;margin-top:6px">'
      +   '<strong>Owner:</strong> ' + _esc(l.owner_name) + ' &nbsp;|&nbsp; '
      +   '<strong>Mobile:</strong> <a href="tel:' + _esc(l.mobile) + '" style="color:var(--brand)">' + _esc(l.mobile) + '</a><br>'
      +   '<strong>Location:</strong> ' + _esc(l.village) + ', ' + _esc(l.taluka) + ', ' + _esc(l.district)
      +   (l.notes ? '<br><strong>Notes:</strong> ' + _esc(l.notes) : '')
      + '</div>'
      + (Array.isArray(l.products) && l.products.length
        ? '<div style="margin-top:8px;padding:6px 10px;background:var(--brand-pale);border-radius:8px;font-size:.78rem;color:var(--brand);font-weight:600">'
          + '📦 ' + l.products.length + ' product(s) — Total: ₹' + l.products.reduce(function(s,p){return s+parseFloat(p.total||(parseFloat(p.price||0)*(p.quantity||p.qty||1)));},0).toFixed(2)
          + '</div>'
        : '')
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">'
      +   '<span style="font-size:.75rem;color:var(--ink-soft)">🕐 ' + fmtDT(l.visited_at) + '</span>'
      +   '<div style="display:flex;gap:6px">'
      +     '<button class="btn btn-outline btn-sm" onclick="viewLead(' + l.id + ')">View</button>'
      +     '<button class="btn btn-outline btn-sm" onclick="editLead(' + l.id + ')">Edit</button>'
      +   '</div></div>'
      + '</div>';
  }).join('');
}

/* ── Photo lightbox ───────────────────────────────────────── */
function viewPhoto(leadId) {
  const lead = allLeads.find(function(l) { return l.id == leadId; });
  if (!lead || !lead.photo_proof) return;
  document.getElementById('photoModalImg').src = lead.photo_proof;
  document.getElementById('photoModal').classList.add('show');
}
function closePhotoModal() {
  const el = document.getElementById('photoModal');
  if (el) el.classList.remove('show');
}

/* ── ADD / EDIT LEAD ──────────────────────────────────────── */
function openAddLead() {
  const form = document.getElementById('leadForm');
  if (!form) return;
  document.getElementById('leadId').value = '';
  form.reset();
  document.getElementById('lPhotoData').value = '';
  const ppb = document.getElementById('photoPreviewBox');
  const ua  = document.getElementById('uploadArea');
  if (ppb) ppb.classList.add('hidden');
  if (ua)  ua.style.display = '';
  const errDiv = document.getElementById('leadFormError');
  if (errDiv) errDiv.classList.add('hidden');
  document.getElementById('leadModalTitle').textContent = '➕ Add Shop Lead';
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('lVisitedAt').value = now.toISOString().slice(0, 16);
  const noRadio = document.querySelector('input[name=lSaleStatus][value=NO]');
  if (noRadio) noRadio.checked = true;

  resetTalukaField();

  // ── Reset + load products ────────────────────────────────
  _resetProductSelector();
  loadProductsDropdown();

  openModal('leadModal');
}

async function editLead(id) {
  const lead = allLeads.find(function(l) { return l.id == id; }) || await fetchLead(id);
  if (!lead) return;
  document.getElementById('leadId').value    = lead.id;
  document.getElementById('lShopName').value = lead.shop_name;
  document.getElementById('lShopType').value = lead.shop_type || '';
  document.getElementById('lOwner').value    = lead.owner_name;
  document.getElementById('lMobile').value   = lead.mobile;
  document.getElementById('lVillage').value  = lead.village;
  // Set taluka — might be select (restricted) or input
  resetTalukaField();
  const talukaEl = document.getElementById('lTaluka');
  if (talukaEl) talukaEl.value = lead.taluka;
  const districtEl = document.getElementById('lDistrict');
  if (districtEl) districtEl.value = lead.district;
  document.getElementById('lNotes').value    = lead.notes || '';
  const radio = document.querySelector('input[name=lSaleStatus][value=' + lead.sale_status + ']');
  if (radio) radio.checked = true;
  if (lead.visited_at) {
    const d = new Date(lead.visited_at);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    document.getElementById('lVisitedAt').value = d.toISOString().slice(0, 16);
  }
  const ppb = document.getElementById('photoPreviewBox');
  const ua  = document.getElementById('uploadArea');
  if (lead.photo_proof) {
    document.getElementById('lPhotoData').value = lead.photo_proof;
    document.getElementById('photoPreview').src = lead.photo_proof;
    if (ppb) ppb.classList.remove('hidden');
    if (ua)  ua.style.display = 'none';
  } else {
    document.getElementById('lPhotoData').value = '';
    if (ppb) ppb.classList.add('hidden');
    if (ua)  ua.style.display = '';
  }
  const errDiv = document.getElementById('leadFormError');
  if (errDiv) errDiv.classList.add('hidden');
  document.getElementById('leadModalTitle').textContent = '✏️ Edit Lead';

  // ── Populate products ────────────────────────────────────
  _resetProductSelector();
  await loadProductsDropdown();
  if (Array.isArray(lead.products) && lead.products.length) {
    _psSelected = lead.products.map(function(p) {
      return {
        product_id: p.product_id,
        name:       p.name,
        price:      parseFloat(p.price)    || 0,
        quantity:   parseInt(p.quantity, 10) || 1,
        total:      parseFloat(p.total)    || 0,
      };
    });
    _psRenderTable();
    _psRebuildDropdown();
  }

  openModal('leadModal');
}

async function fetchLead(id) {
  try {
    const res  = await apiFetch(API + '/salesman/leads/' + id);
    const json = await safeJson(res);
    return json.data || null;
  } catch(e) {
    showToast('Could not load lead: ' + e.message, 'error');
    return null;
  }
}

async function viewLead(id) {
  const lead = allLeads.find(function(l) { return l.id == id; }) || await fetchLead(id);
  if (!lead) return;
  const content = document.getElementById('leadDetailContent');
  if (!content) return;

  function renderDetail(products) {
    var prodHtml = '';
    if (products && products.length) {
      var grandTotal = products.reduce(function(s, p) {
        return s + parseFloat(p.total || (parseFloat(p.price||0) * (p.quantity||p.qty||1)));
      }, 0);
      prodHtml = '<div style="margin-top:14px">'
        + '<div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft);margin-bottom:8px">📦 Products (' + products.length + ')</div>'
        + '<table style="width:100%;border-collapse:collapse;font-size:.8rem;border:1px solid var(--border);border-radius:10px;overflow:hidden">'
        + '<thead><tr style="background:var(--brand-ultra)">'
        + '<th style="padding:7px 10px;text-align:left;font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--brand);border-bottom:1px solid var(--border)">Product</th>'
        + '<th style="padding:7px 10px;text-align:center;font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--brand);border-bottom:1px solid var(--border)">Qty</th>'
        + '<th style="padding:7px 10px;text-align:right;font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--brand);border-bottom:1px solid var(--border)">Price</th>'
        + '<th style="padding:7px 10px;text-align:right;font-size:.62rem;font-weight:700;text-transform:uppercase;color:var(--brand);border-bottom:1px solid var(--border)">Total</th>'
        + '</tr></thead><tbody>'
        + products.map(function(p, i) {
            var price = parseFloat(p.price || 0);
            var qty   = p.quantity || p.qty || 1;
            var total = parseFloat(p.total || (price * qty));
            return '<tr style="' + (i % 2 === 0 ? 'background:var(--surface-2)' : '') + ';border-bottom:1px solid var(--border)">'
              + '<td style="padding:8px 10px"><div style="font-weight:600;color:var(--ink)">' + _esc(p.name) + '</div>'
              + (p.category ? '<div style="font-size:.68rem;color:var(--ink-soft)">' + _esc(p.category) + '</div>' : '')
              + '</td>'
              + '<td style="padding:8px 10px;text-align:center;color:var(--ink-mid)">' + qty + '</td>'
              + '<td style="padding:8px 10px;text-align:right;color:var(--ink-mid)">₹' + price.toFixed(2) + '</td>'
              + '<td style="padding:8px 10px;text-align:right;font-weight:700;color:var(--brand)">₹' + total.toFixed(2) + '</td>'
              + '</tr>';
          }).join('')
        + '</tbody><tfoot><tr style="background:var(--surface-2)">'
        + '<td colspan="3" style="padding:8px 10px;text-align:right;font-weight:700">Grand Total</td>'
        + '<td style="padding:8px 10px;text-align:right;font-weight:800;color:var(--brand)">₹' + grandTotal.toFixed(2) + '</td>'
        + '</tr></tfoot></table></div>';
    } else if (products) {
      prodHtml = '<div style="margin-top:12px;font-size:.78rem;color:var(--ink-soft);text-align:center;padding:12px;background:var(--surface-2);border-radius:8px">No products recorded for this lead.</div>';
    }

    content.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:.86rem;line-height:1.9">'
      + '<div><strong>Shop:</strong> ' + _esc(lead.shop_name) + '</div>'
      + '<div><strong>Type:</strong> ' + _esc(lead.shop_type || '—') + '</div>'
      + '<div><strong>Owner:</strong> ' + _esc(lead.owner_name) + '</div>'
      + '<div><strong>Mobile:</strong> <a href="tel:' + _esc(lead.mobile) + '" style="color:var(--brand)">' + _esc(lead.mobile) + '</a></div>'
      + '<div><strong>Village:</strong> ' + _esc(lead.village) + '</div>'
      + '<div><strong>Taluka:</strong> ' + _esc(lead.taluka) + '</div>'
      + '<div style="grid-column:1/-1"><strong>District:</strong> ' + _esc(lead.district) + '</div>'
      + '<div style="grid-column:1/-1"><strong>Sale Status:</strong> <span class="' + (lead.sale_status === 'YES' ? 'sale-yes' : 'sale-no') + '">' + (lead.sale_status === 'YES' ? '✅ SALE DONE' : '❌ NO SALE') + '</span></div>'
      + '<div style="grid-column:1/-1"><strong>Visited:</strong> ' + fmtDT(lead.visited_at) + '</div>'
      + (lead.notes ? '<div style="grid-column:1/-1"><strong>Notes:</strong> ' + _esc(lead.notes) + '</div>' : '')
      + '</div>'
      + prodHtml
      + (lead.photo_proof
        ? '<div style="margin-top:14px;text-align:center"><div style="font-size:.8rem;color:var(--ink-soft);margin-bottom:6px;font-weight:600">📷 PHOTO PROOF</div>'
          + '<img src="' + lead.photo_proof + '" style="max-width:100%;max-height:280px;border-radius:8px;border:2px solid var(--border);cursor:pointer" '
          + 'onclick="document.getElementById(\'photoModalImg\').src=\'' + lead.photo_proof + '\';document.getElementById(\'photoModal\').classList.add(\'show\')" /></div>'
        : '')
      + '<div style="margin-top:14px;display:flex;gap:8px">'
      + '<button class="btn btn-primary btn-sm" onclick="editLead(' + lead.id + ');closeModal(\'leadDetailModal\')">✏️ Edit</button>'
      + '</div>';
  }

  // Products already attached by getLeads — use them directly, no extra fetch needed
  var products = Array.isArray(lead.products) ? lead.products : null;
  renderDetail(products !== null ? products : []);
  openModal('leadDetailModal');
}

function closeLead() {
  closeModal('leadModal');
  _resetProductSelector();
}

/* ── Photo handling ───────────────────────────────────────── */
function handlePhoto(input) {
  const file = input.files[0];
  if (!file) return;

  // Client-side validation (UX only — server re-validates with magic bytes):
  // 1. MIME type allowlist — rejects PDFs, docs, etc. renamed as images
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!ALLOWED_TYPES.includes(file.type)) {
    showToast('Only JPEG, PNG, WebP, and GIF images are allowed.', 'error');
    input.value = '';
    return;
  }
  // 2. Size limit — generous 3 MB client-side; server enforces 200 KB base64 cap
  if (file.size > 15 * 1024 * 1024) { showToast('Photo too large. Max 15MB.', 'error'); input.value = ''; return; }

  const reader = new FileReader();
  reader.onload = function(e) {
    const data = e.target.result;
    document.getElementById('lPhotoData').value = data;
    document.getElementById('photoPreview').src = data;
    const ppb = document.getElementById('photoPreviewBox');
    const ua  = document.getElementById('uploadArea');
    if (ppb) ppb.classList.remove('hidden');
    if (ua)  ua.style.display = 'none';
  };
  reader.readAsDataURL(file);
}
function removePhoto() {
  document.getElementById('lPhotoData').value = '';
  document.getElementById('photoInput').value = '';
  const ppb = document.getElementById('photoPreviewBox');
  const ua  = document.getElementById('uploadArea');
  if (ppb) ppb.classList.add('hidden');
  if (ua)  ua.style.display = '';
}

/* ── Form submit ──────────────────────────────────────────── */
const leadFormEl = document.getElementById('leadForm');
if (leadFormEl) {
  leadFormEl.addEventListener('submit', async function(e) {
    e.preventDefault();
    const errDiv = document.getElementById('leadFormError');
    const btn    = document.getElementById('saveLeadBtn');
    if (errDiv) errDiv.classList.add('hidden');
    _clearProductError();
    btn.textContent = '⏳ Saving…'; btn.disabled = true;

    const id = document.getElementById('leadId').value;
    const payload = {
      shop_name:   document.getElementById('lShopName').value.trim(),
      shop_type:   document.getElementById('lShopType').value,
      owner_name:  document.getElementById('lOwner').value.trim(),
      mobile:      document.getElementById('lMobile').value.trim(),
      village:     document.getElementById('lVillage').value.trim(),
      taluka:      document.getElementById('lTaluka').value.trim(),
      district:    document.getElementById('lDistrict').value.trim(),
      sale_status: (document.querySelector('input[name=lSaleStatus]:checked') || {}).value || 'NO',
      photo_proof: document.getElementById('lPhotoData').value || null,
      notes:       document.getElementById('lNotes').value.trim(),
      visited_at:  document.getElementById('lVisitedAt').value || null,
    };

    // ── Basic field validation ────────────────────────────────
    if (!payload.shop_name || !payload.owner_name || !payload.mobile || !payload.village || !payload.taluka || !payload.district) {
      if (errDiv) { errDiv.textContent = 'Please fill all required fields.'; errDiv.classList.remove('hidden'); }
      btn.textContent = '💾 Save Lead'; btn.disabled = false;
      return;
    }

    // ── Products validation ───────────────────────────────────
    if (_psSelected.length === 0) {
      _showProductError('⚠ Please add at least one product.');
      if (errDiv) { errDiv.textContent = 'Please add at least one product.'; errDiv.classList.remove('hidden'); }
      var ps = document.querySelector('.product-section');
      if (ps) ps.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.textContent = '💾 Save Lead'; btn.disabled = false;
      return;
    }
    var productError = null;
    _psSelected.forEach(function(p, i) {
      var priceInp = document.getElementById('ps-price-' + i);
      var qtyInp   = document.getElementById('ps-qty-'   + i);
      if (priceInp) p.price    = Math.max(0, parseFloat(priceInp.value)   || 0);
      if (qtyInp)   p.quantity = Math.max(1, parseInt(qtyInp.value, 10)   || 1);
      p.total = p.price * p.quantity;
      if (p.price < 0)    productError = 'Price for "' + p.name + '" must be ≥ 0.';
      if (p.quantity < 1) productError = 'Quantity for "' + p.name + '" must be ≥ 1.';
    });
    if (productError) {
      _showProductError('⚠ ' + productError);
      if (errDiv) { errDiv.textContent = productError; errDiv.classList.remove('hidden'); }
      btn.textContent = '💾 Save Lead'; btn.disabled = false;
      return;
    }

    // ── Frontend area restriction check ──────────────────────
    if (_myAreas.length && !id) {
      const allowed = _myAreas.map(function(a) { return a.taluka.toLowerCase(); });
      if (!allowed.includes(payload.taluka.toLowerCase())) {
        const blockEl = document.getElementById('areaBlockNotice');
        const msg = '🚫 You are not allowed to add leads in "' + payload.taluka + '". Your assigned areas: ' + _myAreas.map(function(a){return a.taluka;}).join(', ');
        if (blockEl) { blockEl.innerHTML = msg; blockEl.style.display = ''; }
        if (errDiv)  { errDiv.textContent = msg; errDiv.classList.remove('hidden'); }
        btn.textContent = '💾 Save Lead'; btn.disabled = false;
        return;
      }
    }

    // ── Attach products to payload ────────────────────────────
    payload.products = _buildProductsPayload();

    try {
      const url    = id ? API + '/salesman/leads/' + id : API + '/salesman/leads';
      const method = id ? 'PUT' : 'POST';
      const res    = await apiFetch(url, { method: method, body: JSON.stringify(payload) });
      const data   = await safeJson(res);
      if (!data.success) throw new Error(data.message);
      showToast(id ? 'Lead updated ✓' : 'Lead added ✓', 'success');
      closeLead();
      loadLeads();
      loadQuickStats();
    } catch (ex) {
      if (errDiv) { errDiv.textContent = ex.message; errDiv.classList.remove('hidden'); }
    }
    btn.textContent = '💾 Save Lead'; btn.disabled = false;
  });
}

/* ══════════════════════════════════════════════════════════════
   PAGE: REPORTS
══════════════════════════════════════════════════════════════ */
var reportData = null;

if (page === 'reports') {
  salesAuthRehydrate().then(function(ok) {
    if (!ok) return;
    const fromEl = document.getElementById('fromDate');
    const toEl   = document.getElementById('toDate');
    if (fromEl) fromEl.value = monthStart();
    if (toEl)   toEl.value   = todayStr();
    fetchReport();
  });
}

function setPreset(preset, btn) {
  document.querySelectorAll('.preset-btn').forEach(function(b) { b.classList.remove('active'); });
  /* btn is passed via onclick="setPreset('today', this)" — use it directly */
  if (btn) btn.classList.add('active');
  const from = document.getElementById('fromDate');
  const to   = document.getElementById('toDate');
  if (to) to.value = todayStr();
  if (preset === 'today' && from) from.value = todayStr();
  if (preset === 'week'  && from) from.value = weekStart();
  if (preset === 'month' && from) from.value = monthStart();
  if (preset === 'all'   && from) from.value = '2020-01-01';
  fetchReport();
}

function applyRange() { fetchReport(); }

async function fetchReport() {
  const fromEl = document.getElementById('fromDate');
  const toEl   = document.getElementById('toDate');
  const from   = fromEl ? fromEl.value : '';
  const to     = toEl   ? toEl.value   : '';

  const grid = document.getElementById('kpiGrid');
  if (grid) grid.innerHTML = '<div class="loading-overlay" style="grid-column:1/-1"><div class="spinner"></div></div>';

  try {
    const url = API + '/salesman/report?from=' + (from || '') + '&to=' + (to || '');
    const res = await apiFetch(url);
    const json = await safeJson(res);
    if (!json.success) throw new Error(json.message || 'Report failed');
    reportData = json.data;
    renderKPIs(reportData);
    renderBarChart(reportData.daily || []);
    renderDistrictChart(reportData.byDistrict || []);
    fetchRangeLeads(from, to);
  } catch (err) {
    showToast('Report error: ' + err.message, 'error');
    console.error('[salesman] fetchReport:', err.message);
  }
}

function renderKPIs(d) {
  if (!d) return;
  const ids = {
    statTodayV: d.today_visits, statTodayO: d.today_orders,
    statTodayL: d.today_leads,  statMonthL: d.month_leads
  };
  Object.keys(ids).forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.textContent = ids[id] != null ? ids[id] : '0';
  });
  const el = document.getElementById('kpiGrid');
  if (!el) return;
  const cvRate = d.total_leads > 0 ? Math.round((d.yes_leads / d.total_leads) * 100) : 0;
  el.innerHTML =
    '<div class="kpi highlight-sage"><div class="kpi-icon">📋</div><div class="kpi-val">' + d.total_leads + '</div><div class="kpi-lbl">Total Leads</div></div>' +
    '<div class="kpi highlight-green"><div class="kpi-icon">✅</div><div class="kpi-val">' + d.yes_leads + '</div><div class="kpi-lbl">YES Leads</div></div>' +
    '<div class="kpi highlight-red"><div class="kpi-icon">❌</div><div class="kpi-val">' + d.no_leads + '</div><div class="kpi-lbl">NO Leads</div></div>' +
    '<div class="kpi highlight-gold"><div class="kpi-icon">📈</div><div class="kpi-val">' + cvRate + '%</div><div class="kpi-lbl">Conversion</div></div>' +
    '<div class="kpi highlight-blue"><div class="kpi-icon">📅</div><div class="kpi-val">' + d.today_visits + '</div><div class="kpi-lbl">Today Visit</div></div>' +
    '<div class="kpi highlight-green"><div class="kpi-icon">🛍</div><div class="kpi-val">' + d.today_orders + '</div><div class="kpi-lbl">Today Order</div></div>' +
    '<div class="kpi highlight-blue"><div class="kpi-icon">🗒</div><div class="kpi-val">' + d.today_leads + '</div><div class="kpi-lbl">Today Leads</div></div>' +
    '<div class="kpi highlight-sage"><div class="kpi-icon">🗓</div><div class="kpi-val">' + d.month_leads + '</div><div class="kpi-lbl">Month Leads</div></div>';
}

function renderBarChart(daily) {
  const el = document.getElementById('barChart');
  if (!el) return;
  if (!daily.length) { el.innerHTML = '<div style="color:var(--ink-soft);font-size:.85rem;margin:auto">No data in this range</div>'; return; }
  const maxVal = Math.max.apply(null, daily.map(function(d) { return parseInt(d.total) || 0; }).concat([1]));
  const H = 120;
  el.innerHTML = daily.map(function(d) {
    const total = parseInt(d.total)     || 0;
    const yes   = parseInt(d.yes_count) || 0;
    const no    = parseInt(d.no_count)  || 0;
    const yesH  = Math.round((yes / maxVal) * H);
    const noH   = Math.round((no  / maxVal) * H);
    const label = new Date(d.date).toLocaleDateString('en-IN', { day:'numeric', month:'short' });
    return '<div class="bar-group" title="' + label + ': ' + yes + ' yes, ' + no + ' no">'
      + '<div class="bar-stack" style="height:' + H + 'px;justify-content:flex-end">'
      + '<div class="bar-seg bar-no"  style="height:' + noH  + 'px"></div>'
      + '<div class="bar-seg bar-yes" style="height:' + yesH + 'px"></div>'
      + '</div>'
      + '<div class="bar-lbl">' + label + '</div>'
      + '</div>';
  }).join('');
}

function renderDistrictChart(districts) {
  const el = document.getElementById('districtChart');
  if (!el) return;
  if (!districts.length) { el.innerHTML = '<div style="color:var(--ink-soft);font-size:.85rem">No data</div>'; return; }
  const maxVal = Math.max.apply(null, districts.map(function(d) { return parseInt(d.count) || 0; }).concat([1]));
  el.innerHTML = districts.map(function(d) {
    const pct = Math.round(((parseInt(d.count) || 0) / maxVal) * 100);
    return '<div class="district-row">'
      + '<div class="dist-name">' + d.district + '</div>'
      + '<div class="dist-bar"><div class="dist-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="dist-count">' + d.count + '</div>'
      + '<div class="dist-sales">✅' + (d.sales || 0) + '</div>'
      + '</div>';
  }).join('');
}

async function fetchRangeLeads(from, to) {
  const tbody = document.getElementById('reportLeadsBody');
  const badge = document.getElementById('leadsCountBadge');
  if (!tbody) return;

  tbody.innerHTML = spinnerRow(9);

  try {
    let url = API + '/salesman/leads';
    const qs = [];
    if (from) qs.push('from=' + from);
    if (to)   qs.push('to=' + to);
    if (qs.length) url += '?' + qs.join('&');

    const res   = await apiFetch(url);
    const json  = await safeJson(res);
    const leads = Array.isArray(json.data) ? json.data : [];

    if (badge) badge.textContent = leads.length + ' leads';

    if (!leads.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--ink-soft)">No leads in this date range</td></tr>';
      return;
    }

    tbody.innerHTML = leads.map(function(l, i) {
      const photoCell = l.photo_proof
        ? '<img src="' + l.photo_proof + '" style="width:34px;height:34px;object-fit:cover;border-radius:6px;border:1px solid var(--border);cursor:pointer" '
          + 'onclick="document.getElementById(\'photoModalImg\').src=\'' + l.photo_proof + '\';document.getElementById(\'photoModal\').classList.add(\'show\')">'
        : '<span style="color:var(--ink-soft);font-size:.75rem">—</span>';
      return '<tr>'
        + '<td style="color:var(--ink-soft);font-size:.78rem">' + (i+1) + '</td>'
        + '<td><strong>' + _esc(l.shop_name) + '</strong></td>'
        + '<td style="font-size:.78rem;color:var(--ink-soft)">' + _esc(l.shop_type || '—') + '</td>'
        + '<td>' + _esc(l.owner_name) + '</td>'
        + '<td>' + _esc(l.village) + '</td>'
        + '<td>' + _esc(l.taluka) + '</td>'
        + '<td>' + _esc(l.district) + '</td>'
        + '<td><span class="' + (l.sale_status === 'YES' ? 'sale-yes' : 'sale-no') + '">' + l.sale_status + '</span></td>'
        + '<td>' + photoCell + '</td>'
        + '</tr>';
    }).join('');

  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--error)">⚠️ Failed to load leads. Please retry.</td></tr>';
  }
}

/* ── CSV Export ───────────────────────────────────────────── */
async function exportCSV() {
  const from = (document.getElementById('fromDate') || {}).value || '';
  const to   = (document.getElementById('toDate')   || {}).value || '';
  let url    = API + '/salesman/leads';
  const qs   = [];
  if (from) qs.push('from=' + from);
  if (to)   qs.push('to=' + to);
  if (qs.length) url += '?' + qs.join('&');

  try {
    const res   = await apiFetch(url);
    const json  = await safeJson(res);
    const leads = Array.isArray(json.data) ? json.data : [];
    if (!leads.length) { showToast('No data to export', 'error'); return; }

    const header = ['#','Shop Name','Shop Type','Owner','Mobile','Village','Taluka','District','Sale Status','Notes','Visited At'];
    const rows   = leads.map(function(l, i) {
      return [i+1, l.shop_name, l.shop_type||'', l.owner_name, l.mobile,
              l.village, l.taluka, l.district, l.sale_status,
              (l.notes||'').replace(/,/g,' '), fmtDT(l.visited_at)];
    });
    const csv  = [header].concat(rows).map(function(r) { return r.map(function(v) { return '"' + v + '"'; }).join(','); }).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'aqualence-leads-' + (from || 'all') + '-to-' + (to || 'all') + '.csv';
    a.click();
    showToast('CSV exported ✓', 'success');
  } catch(e) {
    showToast('Export failed: ' + e.message, 'error');
  }
}


/* ══ DARK MODE TOGGLE ══════════════════════════════════════════ */
(function(){
  var KEY = 'aqualance_theme';
  function isDark() { return document.documentElement.getAttribute('data-theme')==='dark'; }
  function applyTheme(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.querySelectorAll('.dm-toggle').forEach(function(btn) {
      btn.textContent = dark ? '☀️' : '🌙';
    });
    try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch(e){}
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#060d14' : '#1565a8');
  }
  function injectBtn() {
    var existing = document.getElementById('dmToggleBtn');
    if (existing) {
      existing.addEventListener('click', function() { applyTheme(!isDark()); });
      return;
    }
    var btn = document.createElement('button');
    btn.id = 'dmToggleBtn';
    btn.className = 'dm-toggle dm-float';
    btn.title = 'Toggle dark mode';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.textContent = isDark() ? '☀️' : '🌙';
    btn.addEventListener('click', function() { applyTheme(!isDark()); });
    document.body.appendChild(btn);
  }
  var saved;
  try { saved = localStorage.getItem(KEY); } catch(e){}
  if (!saved) saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  applyTheme(saved === 'dark');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBtn);
  } else {
    injectBtn();
  }
})();
