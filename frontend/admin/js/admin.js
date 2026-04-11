'use strict';

/* ── XSS Guard ───────────────────────────────────────────── */
// All values from the DB rendered into innerHTML MUST pass through _esc().
function _esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str != null ? String(str) : ''));
  return d.innerHTML;
}

/* ─── admin.js ─────────────────────────────────────────────── */
const API = 'https://aqualance-production.up.railway.app/api/v1';

/* ── Safe image src (A05:2025 — Injection) ──────────────────── */
// Prevents javascript: URI injection through product image fields.
// Only allows https://, http://, and data:image/ — everything else is blanked.
function _safeSrc(src) {
  if (!src || typeof src !== 'string') return '';
  const s = src.trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^data:image\//i.test(s)) return s;
  return ''; // reject anything else (javascript:, vbscript:, etc.)
}

/* ── Auth ─────────────────────────────────────────────────── */
// Fix 2: Token is now in an httpOnly cookie — JS can no longer read it.
// User profile (id, name, role) stored in sessionStorage for fast UX checks only.
// sessionStorage is cleared automatically when the tab/browser closes.
function getAdminUser() {
  try { return JSON.parse(sessionStorage.getItem('aq_admin_user') || 'null'); }
  catch { return null; }
}

function adminAuth() {
  // Legacy stub — do not redirect synchronously; rehydration handles it.
  return !!getAdminUser();
}

// Rehydrate sessionStorage from the server if the tab was closed/reopened.
// The httpOnly cookie may still be valid even after sessionStorage was cleared.
// Runs before any page logic; resolves true if session is valid, false if not.
async function adminAuthRehydrate() {
  // Auth gate in network.js handles rehydration — just wait for it
  if (window._aqAuthReady) await window._aqAuthReady.catch(function(){});
  return !!getAdminUser();
}

var _adminLoggingOut = false;
async function adminLogout() {
  if (_adminLoggingOut) return;
  _adminLoggingOut = true;
  try {
    // Fix 1+2: Tell the server to revoke the jti and clear the httpOnly cookie
    await fetch(`${API}/auth/logout`, { method: 'POST', credentials: 'include' });
  } catch (_) { /* best-effort — always redirect */ }
  sessionStorage.removeItem('aq_admin_user');
  localStorage.removeItem('aq_token');
  window.location.replace('/admin/login.html');
}
// Expose on window so network.js auth-guard (patchApiFetch) can call it
// when it intercepts a 401/403 response — regardless of load order.
window.adminLogout = adminLogout;
window.adminAuthRehydrate = adminAuthRehydrate;

function authHeader() {
  // Send Bearer token as fallback for mobile browsers that block cross-site cookies
  const token = localStorage.getItem('aq_token');
  return token
    ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }
    : { 'Content-Type': 'application/json' };
}

/* ── Fetch wrapper: auth + content-type ──────────────────── */
// 401/403 handling: this function is wrapped by network.js (patchApiFetch) which
// injects adaptive timeout/retry and checks for 401/403 BEFORE returning the
// response here. If network.js is not loaded (e.g. standalone test), the
// fallback guard below catches it so logout always fires.
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',   // Fix 2: send httpOnly cookie automatically
    headers: { ...authHeader(), ...(options.headers || {}) },
  });
  // 401/403 handled centrally by network.js patchApiFetch — do not duplicate here
  return res;
}

/* ── Toast ────────────────────────────────────────────────── */
function showToast(msg, type = 'default') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* ── Modal ────────────────────────────────────────────────── */
function openModal(id) { document.getElementById(id)?.classList.add('show'); }
function closeModal(id){ document.getElementById(id)?.classList.remove('show'); }

/* ── Format helpers ───────────────────────────────────────── */
function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }); }
function fmtCurrency(v) { return `₹${parseFloat(v).toFixed(2)}`; }
function statusBadge(s) { return `<span class="status status-${s}">${s.replace('_',' ')}</span>`; }

/* ── MFA OTP step (shown after password if MFA is enabled) ──── */
function showMfaStep() {
  const form = document.getElementById('loginForm');
  // Replace the form content with OTP input
  form.innerHTML = `
    <p style="font-size:.82rem;color:var(--ink-soft);margin-bottom:14px;text-align:center;">
      Open <strong>Google Authenticator</strong> and enter the 6-digit code for Aqualence Admin.
    </p>
    <div class="form-group">
      <label for="otpInput">Authenticator Code</label>
      <input type="text" id="otpInput" inputmode="numeric" maxlength="6"
             placeholder="000000" autocomplete="one-time-code"
             style="font-size:1.4rem;letter-spacing:.3em;text-align:center;" />
    </div>
    <button type="button" class="btn btn-primary btn-full" id="otpBtn" onclick="submitOtp()">Verify</button>
    <button type="button" class="btn btn-outline btn-full" onclick="cancelMfa()"
      style="margin-top:8px;font-size:.8rem;">← Back to Login</button>
  `;
  document.getElementById('loginForm').removeAttribute('id');
  // re-focus
  setTimeout(() => document.getElementById('otpInput')?.focus(), 100);
}

async function submitOtp() {
  const errDiv = document.getElementById('loginError');
  const btn    = document.getElementById('otpBtn');
  const otp    = document.getElementById('otpInput')?.value.trim();
  const token  = sessionStorage.getItem('aq_mfa_token');

  errDiv.classList.add('hidden');
  if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
    errDiv.textContent = 'Enter your 6-digit authenticator code.';
    errDiv.classList.remove('hidden');
    return;
  }
  btn.textContent = 'Verifying…'; btn.disabled = true;

  try {
    const res = await fetch(`${API}/auth/mfa/verify-login`, {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mfa_token: token, otp }),
    });
    const data = await res.json();
    sessionStorage.removeItem('aq_mfa_token');
    if (!data.success) throw new Error(data.message);
    if (!data.user || data.user.role !== 'admin') throw new Error('Access denied. Admin only.');
    sessionStorage.setItem('aq_admin_user', JSON.stringify(data.user));
    if (data.token) localStorage.setItem('aq_token', data.token);
    if (data.user.must_change_password) {
      window.location.replace('/admin/change-password.html');
      return;
    }
    window.location.replace('/admin/dashboard.html');
  } catch (err) {
    errDiv.textContent = err.message;
    errDiv.classList.remove('hidden');
    btn.textContent = 'Verify'; btn.disabled = false;
  }
}

function cancelMfa() {
  sessionStorage.removeItem('aq_mfa_token');
  window.location.reload();
}

/* ── SMS OTP step ──────────────────────────────────────────────────────── */
function showSmsOtpStep() {
  const form = document.getElementById('loginForm');
  form.innerHTML = `
    <p style="font-size:.82rem;color:var(--ink-soft);margin-bottom:14px;text-align:center;line-height:1.6;">
      A 6-digit OTP has been sent to your registered mobile number.<br>
      It expires in <strong>5 minutes</strong>.
    </p>
    <div class="form-group">
      <label for="smsOtpInput">Enter OTP</label>
      <input type="text" id="smsOtpInput" inputmode="numeric" maxlength="6"
             placeholder="000000" autocomplete="one-time-code"
             style="font-size:1.4rem;letter-spacing:.35em;text-align:center;" />
    </div>
    <button type="button" class="btn btn-primary btn-full" id="smsOtpBtn"
            onclick="submitSmsOtp()">Verify OTP</button>
    <div style="text-align:center;margin-top:8px">
      <button type="button" onclick="resendSmsOtp()"
        style="background:none;border:none;color:var(--sage);font-size:.8rem;cursor:pointer;text-decoration:underline;"
        id="resendOtpBtn">Resend OTP</button>
    </div>
    <button type="button" onclick="cancelSmsOtp()"
      style="margin-top:12px;background:none;border:none;font-size:.78rem;color:var(--ink-soft);cursor:pointer;width:100%;">
      ← Back to Login
    </button>
  `;
  document.getElementById('loginForm').removeAttribute('id');
  setTimeout(() => document.getElementById('smsOtpInput')?.focus(), 100);
}

async function submitSmsOtp() {
  const errDiv = document.getElementById('loginError');
  const btn    = document.getElementById('smsOtpBtn');
  const otp    = document.getElementById('smsOtpInput')?.value.trim();
  const token  = sessionStorage.getItem('aq_otp_token');

  errDiv.classList.add('hidden');
  if (!otp || !/^\d{6}$/.test(otp)) {
    errDiv.textContent = 'Enter your 6-digit OTP.';
    errDiv.classList.remove('hidden');
    return;
  }

  btn.textContent = 'Verifying…'; btn.disabled = true;
  try {
    const res = await fetch(`${API}/auth/verify-otp`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_token: token, otp }),
    });
    const data = await res.json();
    sessionStorage.removeItem('aq_otp_token');
    if (!data.success) throw new Error(data.message);
    if (!data.user || data.user.role !== 'admin') throw new Error('Access denied. Admin only.');
    sessionStorage.setItem('aq_admin_user', JSON.stringify(data.user));
    if (data.token) localStorage.setItem('aq_token', data.token);
    if (data.user.must_change_password) { window.location.replace('/admin/change-password.html'); return; }
    window.location.replace('/admin/dashboard.html');
  } catch (err) {
    errDiv.textContent = err.message;
    errDiv.classList.remove('hidden');
    btn.textContent = 'Verify OTP'; btn.disabled = false;
  }
}

async function resendSmsOtp() {
  const btn   = document.getElementById('resendOtpBtn');
  const token = sessionStorage.getItem('aq_otp_token');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res = await fetch(`${API}/auth/resend-otp`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp_token: token }),
    });
    const data = await res.json();
    btn.textContent = data.success ? '✓ Sent!' : 'Resend OTP';
    setTimeout(() => { btn.textContent = 'Resend OTP'; btn.disabled = false; }, 30000);
  } catch { btn.textContent = 'Resend OTP'; btn.disabled = false; }
}

function cancelSmsOtp() {
  sessionStorage.removeItem('aq_otp_token');
  window.location.reload();
}

/* ─────────────────────────────────────────────────────────────
   LOGIN PAGE
───────────────────────────────────────────────────────────── */
if (document.getElementById('loginForm')) {
  // ✅ FIX (Login Loop): Do NOT redirect based on sessionStorage alone.
  // On mobile/PWA, sessionStorage can survive tab navigations, so getAdminUser()
  // may return a stale object after session expiry → causes login ↔ dashboard loop.
  // network.js _runAuthGate() validates the httpOnly cookie via /auth/me and
  // handles the redirect to dashboard automatically if the session is still valid.

  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const errDiv = document.getElementById('loginError');
    errDiv.classList.add('hidden');
    const btn = document.getElementById('loginBtn');
    btn.textContent = 'Logging in…'; btn.disabled = true;

    try {
      const res = await fetch(`${API}/auth/login`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone:    (document.getElementById('phone')?.value || '').trim(),
          password: document.getElementById('password')?.value || '',
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      // ── MFA step (TOTP) ──────────────────────────────────────────────────
      if (data.mfa_required) {
        sessionStorage.setItem('aq_mfa_token', data.mfa_token);
        showMfaStep();
        btn.textContent = 'Login'; btn.disabled = false;
        return;
      }

      // ── SMS OTP step ─────────────────────────────────────────────────────
      if (data.otp_required) {
        sessionStorage.setItem('aq_otp_token', data.otp_token);
        showSmsOtpStep();
        btn.textContent = 'Login'; btn.disabled = false;
        return;
      }

      if (!data.user || data.user.role !== 'admin') throw new Error('Access denied. Admin only.');
      sessionStorage.setItem('aq_admin_user', JSON.stringify(data.user));
      if (data.token) localStorage.setItem('aq_token', data.token);
      if (data.user.must_change_password) {
        window.location.replace('/admin/change-password.html');
        return;
      }
      window.location.replace('/admin/dashboard.html');
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
      btn.textContent = 'Login'; btn.disabled = false;
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   AUTHENTICATED PAGES — common setup
───────────────────────────────────────────────────────────── */
const page = window.location.pathname.split('/').pop().replace('.html','');

if (page !== 'login') {
  adminAuthRehydrate().then(ok => {
    if (!ok) return; // redirect already fired inside rehydrate
    const user = getAdminUser();
    const nameEl = document.getElementById('sidebarName');
    if (nameEl && user) nameEl.textContent = user.name;

    // Click outside modal to close
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => { if (e.target === el) el.classList.remove('show'); });
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   DASHBOARD — independent fetches so one failure doesn't block the other
───────────────────────────────────────────────────────────── */
if (page === 'dashboard') {
  adminAuthRehydrate().then(function(ok) { if (!ok) return; loadDashboardStats(); loadRecentOrders(); });
}

async function loadDashboardStats() {
  const grid = document.getElementById('statsGrid');
  if (!grid) return;
  try {
    const res  = await apiFetch(`${API}/orders/stats`);
    const json = await res.json();
    const s    = json.data;
    if (!s) throw new Error(json.message || 'No stats data');
    grid.innerHTML = `
      <div class="stat-card"><div class="stat-icon">📋</div><div class="stat-label">Total Orders</div><div class="stat-value">${s.total_orders ?? 0}</div></div>
      <div class="stat-card"><div class="stat-icon">⏳</div><div class="stat-label">Pending</div><div class="stat-value" style="color:var(--warn)">${s.pending ?? 0}</div></div>
      <div class="stat-card"><div class="stat-icon">🚴</div><div class="stat-label">Out for Del.</div><div class="stat-value" style="color:#7b1fa2">${(parseInt(s.assigned)||0)+(parseInt(s.out_for_delivery)||0)}</div></div>
      <div class="stat-card"><div class="stat-icon">✅</div><div class="stat-label">Delivered</div><div class="stat-value green">${s.delivered ?? 0}</div></div>
      <div class="stat-card"><div class="stat-icon">💰</div><div class="stat-label">Revenue</div><div class="stat-value gold" style="font-size:clamp(.82rem,3vw,1.5rem)">₹${parseFloat(s.revenue||0).toLocaleString('en-IN',{maximumFractionDigits:0})}</div></div>
      <div class="stat-card"><div class="stat-icon">📦</div><div class="stat-label">Products</div><div class="stat-value">${s.products ?? 0}</div></div>
      <div class="stat-card"><div class="stat-icon">🚴</div><div class="stat-label">Del. Boys</div><div class="stat-value">${s.delivery_boys ?? 0}</div></div>
      <div class="stat-card" style="opacity:0;pointer-events:none;border:none;background:transparent;box-shadow:none"></div>
    `;
  } catch (err) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--error)">
      ⚠️ Stats unavailable
      <button class="btn btn-outline btn-sm" style="margin-left:12px" onclick="loadDashboardStats()">↻ Retry</button>
    </div>`;
    console.error('[admin] loadDashboardStats:', err.message);
  }
}

async function loadRecentOrders() {
  const tbody = document.getElementById('recentOrdersBody');
  if (!tbody) return;
  try {
    const res    = await apiFetch(`${API}/orders`);
    const json   = await res.json();
    const orders = (json.data || []).slice(0, 10);
    if (!orders.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="padding:32px;color:var(--ink-soft)">No orders yet</td></tr>';
      return;
    }
    tbody.innerHTML = orders.map(o => `
      <tr>
        <td><span style="font-weight:600;color:var(--sage)">${_esc(o.order_number)}</span></td>
        <td>${_esc(o.shop_name)}</td>
        <td>${_esc(o.phone)}</td>
        <td>${_esc(o.city)}</td>
        <td>${fmtCurrency(o.total_price)}</td>
        <td>${statusBadge(o.status)}</td>
        <td>${fmtDate(o.created_at)}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--error)">
      ⚠️ ${err.message}
      <button class="btn btn-outline btn-sm" style="margin-left:12px" onclick="loadRecentOrders()">↻ Retry</button>
    </td></tr>`;
    console.error('[admin] loadRecentOrders:', err.message);
  }
}

/* ─────────────────────────────────────────────────────────────
   ORDERS PAGE
───────────────────────────────────────────────────────────── */
let allOrders = [];
let deliveryBoysList = [];
let selectedOrderId = null;

async function loadOrders() {
  if (page !== 'orders') return;
  const status = document.getElementById('statusFilter')?.value || 'all';
  const url = status === 'all' ? `${API}/orders` : `${API}/orders?status=${status}`;
  try {
    const res = await apiFetch(url);
    allOrders = (await res.json()).data || [];
    renderOrdersTable(allOrders);
  } catch (err) { showToast('Error loading orders: ' + err.message, 'error'); }
}

function renderOrdersTable(orders) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center" style="padding:40px;color:var(--ink-soft)">No orders found</td></tr>';
    return;
  }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td><span style="font-weight:600;color:var(--sage)">${_esc(o.order_number)}</span></td>
      <td>${_esc(o.shop_name)}</td>
      <td>${_esc(o.phone)}</td>
      <td>${_esc(o.city)}</td>
      <td>${fmtCurrency(o.total_price)}</td>
      <td>${o.delivery_name || '<span style="color:var(--ink-soft)">Unassigned</span>'}</td>
      <td>${statusBadge(o.status)}</td>
      <td style="white-space:nowrap">${fmtDate(o.created_at)}</td>
      <td><button class="btn btn-outline btn-sm" onclick="viewOrder(${o.id})">View</button></td>
    </tr>`).join('');
}

async function viewOrder(id) {
  selectedOrderId = id;
  openModal('orderModal');
  document.getElementById('orderDetailContent').innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
  try {
    const res  = await apiFetch(`${API}/orders/${id}`);
    const data = (await res.json()).data;
    document.getElementById('orderDetailContent').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;font-size:.85rem;">
        <div><strong>Order:</strong> ${_esc(data.order_number)}</div>
        <div><strong>Date:</strong> ${fmtDate(data.created_at)}</div>
        <div><strong>Customer:</strong> ${_esc(data.customer_name)}</div>
        <div><strong>Shop:</strong> ${_esc(data.shop_name)}</div>
        <div><strong>Phone:</strong> ${_esc(data.phone)}</div>
        <div><strong>Status:</strong> ${statusBadge(data.status)}</div>
        <div style="grid-column:1/-1"><strong>Address:</strong> ${_esc(data.address)}, ${_esc(data.city)} - ${_esc(data.pincode)}</div>
        ${data.notes ? `<div style="grid-column:1/-1"><strong>Notes:</strong> ${_esc(data.notes)}</div>` : ''}
      </div>
      <strong>Items:</strong>
      <table style="width:100%;margin-top:8px;border-collapse:collapse;font-size:.85rem;">
        <thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid var(--border)">Product</th><th style="padding:6px;border-bottom:1px solid var(--border)">Qty</th><th style="text-align:right;padding:6px;border-bottom:1px solid var(--border)">Price</th></tr></thead>
        <tbody>${(data.items||[]).map(i => `<tr><td style="padding:6px">${_esc(i.product_name)}</td><td style="text-align:center;padding:6px">${i.quantity}</td><td style="text-align:right;padding:6px">${fmtCurrency(i.price * i.quantity)}</td></tr>`).join('')}</tbody>
      </table>
      <div style="text-align:right;font-weight:700;font-size:1rem;margin-top:8px;color:var(--sage)">Total: ${fmtCurrency(data.total_price)}</div>
    `;
    // Set current status in select
    const statusSel = document.getElementById('updateStatusSelect');
    if (statusSel) statusSel.value = data.status;
    // Load delivery boys
    await loadDeliveryBoysForSelect(data.delivery_id);
  } catch { document.getElementById('orderDetailContent').textContent = 'Failed to load order.'; }
}

async function loadDeliveryBoysForSelect(currentDeliveryId) {
  const sel = document.getElementById('assignDeliverySelect');
  if (!sel) return;
  try {
    const res = await apiFetch(`${API}/delivery/boys`);
    deliveryBoysList = (await res.json()).data || [];
    sel.innerHTML = `<option value="">— Select Delivery Boy —</option>` +
      deliveryBoysList.map(d => `<option value="${d.id}" ${d.id == currentDeliveryId ? 'selected':''}>${_esc(d.name)} (${_esc(d.phone)})</option>`).join('');
  } catch {}
}

async function assignDelivery() {
  const deliveryId = document.getElementById('assignDeliverySelect')?.value;
  if (!deliveryId || !selectedOrderId) return showToast('Select a delivery boy first', 'error');
  try {
    const res  = await apiFetch(`${API}/orders/assign-delivery`, {
      method: 'PUT',
      body: JSON.stringify({ order_id: selectedOrderId, delivery_id: parseInt(deliveryId) }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showToast('Delivery boy assigned ✓', 'success');
    closeModal('orderModal');
    loadOrders();
  } catch (err) { showToast(err.message, 'error'); }
}

async function updateOrderStatus() {
  const status = document.getElementById('updateStatusSelect')?.value;
  if (!status || !selectedOrderId) return;
  try {
    const res  = await apiFetch(`${API}/orders/update-status`, {
      method: 'PUT',
      body: JSON.stringify({ order_id: selectedOrderId, status }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showToast('Status updated ✓', 'success');
    closeModal('orderModal');
    loadOrders();
  } catch (err) { showToast(err.message, 'error'); }
}

// Search filter
document.getElementById('searchOrders')?.addEventListener('input', function() {
  const q = this.value.toLowerCase();
  renderOrdersTable(allOrders.filter(o =>
    o.order_number.toLowerCase().includes(q) ||
    o.shop_name.toLowerCase().includes(q) ||
    o.phone.includes(q) ||
    o.city.toLowerCase().includes(q)
  ));
});

if (page === 'orders') adminAuthRehydrate().then(function(ok) { if (ok) loadOrders(); });

/* ─────────────────────────────────────────────────────────────
/* ─────────────────────────────────────────────────────────────
   PRODUCTS PAGE
───────────────────────────────────────────────────────────── */

/* ─────────────────────────────────────────────────────────────
   PRODUCTS PAGE
───────────────────────────────────────────────────────────── */
let allProductsList = [];

async function loadProducts() {
  if (page !== 'products') return;
  try {
    const res = await apiFetch(`${API}/products`);
    allProductsList = (await res.json()).data || [];
    filterProducts();
  } catch (err) { showToast('Error loading products: ' + err.message, 'error'); }
}

function filterProducts() {
  const q   = (document.getElementById('searchProducts')?.value || '').toLowerCase();
  const cat = document.getElementById('catFilter')?.value || '';
  const filtered = allProductsList.filter(p =>
    (!q   || p.name.toLowerCase().includes(q)) &&
    (!cat || p.category === cat)
  );
  renderProductsTable(filtered);
}

function renderProductsTable(products) {
  const tbody = document.getElementById('productsTableBody');
  const cards = document.getElementById('productCards');
  if (!tbody) return;

  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center" style="padding:40px;color:var(--ink-soft)">No products found</td></tr>';
    if (cards) cards.innerHTML = '<div style="text-align:center;padding:40px;color:var(--ink-soft);font-size:.85rem">No products found</div>';
    return;
  }

  tbody.innerHTML = products.map(p => {
    const safeName     = p.name.replace(/'/g, "\\'");
    const imgHtml      = p.image
      ? `<img src="${_safeSrc(p.image)}" alt="${_esc(p.name)}" class="prod-thumb" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="prod-thumb-placeholder" style="display:none">🌿</div>`
      : `<div class="prod-thumb-placeholder">🌿</div>`;
    const bundgeBadge  = p.is_bundle ? `<span class="bundle-badge">📦 Bundle</span>` : '';
    const variantBadge = p.variant_count > 0 ? `<span class="variant-badge">${p.variant_count} var</span>` : '';
    const typeBadge    = p.product_type && p.product_type !== 'single'
      ? `<span class="type-badge">${_esc(p.product_type)}</span>` : '';
    return `<tr>
      <td>
        <div class="prod-name-cell">
          ${imgHtml}
          <div style="min-width:0">
            <span class="prod-name-text" title="${_esc(p.name)}">${_esc(p.name)}</span>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:3px">${bundgeBadge}${variantBadge}</div>
          </div>
        </div>
      </td>
      <td><span class="tag tag-sage">${_esc(p.category)}</span></td>
      <td style="white-space:nowrap">${typeBadge || `<span style="font-size:.78rem;color:var(--ink-soft)">${_esc(p.unit||'piece')}</span>`}</td>
      <td style="white-space:nowrap">
        <div><b>${fmtCurrency(p.price)}</b></div>
        ${p.distributor_price ? `<div style="font-size:.72rem;color:#7b1fa2;margin-top:2px">Dist: ${fmtCurrency(p.distributor_price)}</div>` : ''}
      </td>
      <td style="white-space:nowrap">${p.mrp ? fmtCurrency(p.mrp) : '—'}</td>
      <td style="font-weight:600">${p.stock}</td>
      <td>${p.is_active ? '<span class="tag tag-green">Active</span>' : '<span class="tag tag-red">Inactive</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-outline btn-sm" onclick="editProduct(${p.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id},'${safeName}')">Delete</button>
      </td>
    </tr>`;
  }).join('');

  if (!cards) return;
  cards.innerHTML = products.map(p => {
    const safeName    = p.name.replace(/'/g, "\\'");
    const imgHtml     = p.image
      ? `<img src="${_safeSrc(p.image)}" alt="${_esc(p.name)}" class="prod-card-img" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="prod-card-img-placeholder" style="display:none">🌿</div>`
      : `<div class="prod-card-img-placeholder">🌿</div>`;
    const status      = p.is_active
      ? '<span class="tag tag-green" style="font-size:.65rem;padding:2px 8px">Active</span>'
      : '<span class="tag tag-red" style="font-size:.65rem;padding:2px 8px">Inactive</span>';
    const bundgeLine  = p.is_bundle ? `<span class="bundle-badge" style="font-size:.6rem">📦 Bundle</span>` : '';
    const variantLine = p.variant_count > 0 ? `<span class="variant-badge" style="font-size:.6rem">${p.variant_count} var</span>` : '';
    return `<div class="prod-card">
      ${imgHtml}
      <div class="prod-card-body">
        <div class="prod-card-name">${_esc(p.name)}</div>
        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px">${bundgeLine}${variantLine}</div>
        <div class="prod-card-meta">
          <span>
            <b>${fmtCurrency(p.price)}</b>${p.mrp?` <span style="text-decoration:line-through;color:var(--ink-faint)">${fmtCurrency(p.mrp)}</span>`:''}
            ${p.distributor_price ? `<div style="font-size:.68rem;color:#7b1fa2;margin-top:1px">Dist: ${fmtCurrency(p.distributor_price)}</div>` : ''}
          </span>
          <span>Stock: <b>${p.stock}</b></span>
          <span>${_esc(p.category)}</span>
          <span style="text-transform:capitalize">${_esc(p.product_type||p.unit||'piece')}</span>
          ${status}
        </div>
        <div class="prod-card-actions">
          <button class="btn btn-outline btn-sm" onclick="editProduct(${p.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProduct(${p.id},'${safeName}')">Del</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function openProductModal(productId) {
  document.getElementById('productId').value = productId || '';
  document.getElementById('productModalTitle').textContent = productId ? 'Edit Product' : 'Add Product';
  document.getElementById('productForm').reset();
  document.getElementById('productFormError').classList.add('hidden');
  if (typeof resetBundleFields  === 'function') resetBundleFields();
  if (typeof resetImageSlots    === 'function') resetImageSlots();
  if (typeof resetVariants      === 'function') resetVariants();
  // Reset product type dropdown to default
  const ptSel = document.getElementById('pProductType');
  if (ptSel) { ptSel.selectedIndex = 0; if (typeof onProductTypeChange === 'function') onProductTypeChange(); }
  if (!productId) openModal('productModal');
}

async function editProduct(id) {
  openProductModal(id);
  try {
    const res = await apiFetch(`${API}/products/${id}`);
    const p   = (await res.json()).data;
    if (!p) throw new Error('Product not found');

    document.getElementById('productId').value    = p.id;
    document.getElementById('pName').value        = p.name;
    const pCat = document.getElementById('pCategory');
    if (pCat) pCat.value = p.category;
    const pDesc = document.getElementById('pDescription');
    if (pDesc) pDesc.value = p.description || '';
    document.getElementById('pPrice').value       = p.price;
    const pMrp = document.getElementById('pMrp');
    if (pMrp) pMrp.value = p.mrp || '';
    const pDistributorPrice = document.getElementById('pDistributorPrice');
    if (pDistributorPrice) pDistributorPrice.value = p.distributor_price || '';
    document.getElementById('pStock').value       = p.stock;

    // Set product type dropdown and sync hidden fields
    if (typeof _setProductTypeDropdown === 'function') {
      _setProductTypeDropdown(p.product_type || 'single', p.unit || 'piece');
    }

    // Images: merge image + images array deduplicated
    const imgs = Array.isArray(p.images) ? [...p.images] : [];
    if (p.image && !imgs.includes(p.image)) imgs.unshift(p.image);
    if (typeof loadImageSlots === 'function') loadImageSlots(imgs);

    // Variants
    if (typeof resetVariants === 'function') resetVariants();
    if (Array.isArray(p.variants)) {
      p.variants.forEach(v => { if (typeof addVariantRow === 'function') addVariantRow(v); });
    }

    // Bundle
    if (typeof prefillBundleFields === 'function') prefillBundleFields(p);
    if (p.is_bundle && typeof loadBundleItems === 'function') {
      await loadBundleItems(p.id);
    }

    openModal('productModal');
  } catch (err) {
    showToast('Could not load product: ' + err.message, 'error');
  }
}

document.getElementById('productForm')?.addEventListener('submit', async function(e) {
  e.preventDefault();
  const errDiv = document.getElementById('productFormError');
  errDiv.classList.add('hidden');

  const id       = document.getElementById('productId')?.value || '';
  const name     = (document.getElementById('pName')?.value || '').trim();
  const price    = parseFloat(document.getElementById('pPrice')?.value || '0');
  const isBundle = typeof _isBundleChecked === 'function' ? _isBundleChecked() : false;

  if (!name) {
    errDiv.textContent = 'Product name is required.';
    errDiv.classList.remove('hidden'); return;
  }
  if (!price || price <= 0) {
    errDiv.textContent = 'A valid price greater than 0 is required.';
    errDiv.classList.remove('hidden'); return;
  }

  const imgPayload      = typeof getImagePayload    === 'function' ? getImagePayload()    : { image: '', images: [] };
  const bundlePayload   = typeof getBundlePayload   === 'function' ? getBundlePayload()   : { is_bundle: false };
  const variantsPayload = typeof getVariantsPayload === 'function' ? getVariantsPayload() : [];
  const bundleItems     = isBundle && typeof getBundleItemsPayload === 'function' ? getBundleItemsPayload() : [];

  const body = {
    name,
    category:          document.getElementById('pCategory')?.value || '',
    description:       (document.getElementById('pDescription')?.value || '').trim(),
    price,
    mrp:               parseFloat(document.getElementById('pMrp')?.value || '') || null,
    distributor_price: parseFloat(document.getElementById('pDistributorPrice')?.value || '') || null,
    stock:             parseInt(document.getElementById('pStock')?.value || '0', 10) || 0,
    unit:              document.getElementById('pUnitVal')?.value || 'piece',
    product_type:      document.getElementById('pProductTypeVal')?.value || 'single',
    is_active:         true,
    ...imgPayload,
    ...bundlePayload,
  };

  try {
    const url    = id ? `${API}/products/${id}` : `${API}/products`;
    const method = id ? 'PUT' : 'POST';
    const res    = await apiFetch(url, { method, body: JSON.stringify(body) });
    const data   = await res.json();
    if (!data.success) throw new Error(data.message);

    const productId = id ? parseInt(id, 10) : data.id;

    // Save variants (empty array = clear all)
    try {
      await apiFetch(`${API}/products/${productId}/variants`, {
        method: 'POST',
        body:   JSON.stringify({ variants: variantsPayload }),
      });
    } catch (vErr) { showToast('Saved, but variants failed: ' + vErr.message, 'error'); }

    // Save bundle components
    if (isBundle && productId) {
      try {
        await apiFetch(`${API}/products/${productId}/bundle-items`, {
          method: 'POST',
          body:   JSON.stringify({ items: bundleItems }),
        });
      } catch (bErr) { showToast('Saved, but bundle components failed: ' + bErr.message, 'error'); }
    }

    showToast(id ? 'Product updated ✓' : 'Product added ✓', 'success');
    closeModal('productModal');
    loadProducts();
  } catch (err) {
    if (err.message && err.message.includes('Session expired')) return;
    errDiv.textContent = err.message;
    errDiv.classList.remove('hidden');
  }
});

async function deleteProduct(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    const res  = await apiFetch(`${API}/products/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showToast('Product deleted', 'success');
    loadProducts();
  } catch (err) { showToast(err.message, 'error'); }
}

if (page === 'products') adminAuthRehydrate().then(function(ok) { if (ok) loadProducts(); });


/* ─────────────────────────────────────────────────────────────
   DELIVERY BOYS PAGE
───────────────────────────────────────────────────────────── */
async function loadDeliveryBoys() {
  if (page !== 'delivery-boys') return;
  try {
    const res  = await apiFetch(`${API}/delivery/boys`);
    const boys = (await res.json()).data || [];
    const tbody = document.getElementById('deliveryBoysBody');
    if (!boys.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="padding:40px;color:var(--ink-soft)">No delivery boys added yet</td></tr>';
      return;
    }
    tbody.innerHTML = boys.map(b => `
      <tr>
        <td><strong>${_esc(b.name)}</strong></td>
        <td>${_esc(b.phone)}</td>
        <td>${b.is_active ? '<span class="tag tag-green">Active</span>' : '<span class="tag tag-red">Removed</span>'}</td>
        <td>${fmtDate(b.created_at)}</td>
        <td>${b.is_active ? `<button class="btn btn-danger btn-sm" onclick="removeDeliveryBoy(${b.id},'${b.name.replace(/'/g,"\\'")}')">Remove</button>` : '—'}</td>
      </tr>`).join('');
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

function openAddDeliveryModal() {
  document.getElementById('addDeliveryForm').reset();
  document.getElementById('addDeliveryError').classList.add('hidden');
  openModal('addDeliveryModal');
}

document.getElementById('addDeliveryForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errDiv = document.getElementById('addDeliveryError');
  errDiv.classList.add('hidden');
  const name     = (document.getElementById('dbName')?.value || '').trim();
  const phone    = (document.getElementById('dbPhone')?.value || '').trim();
  const password = document.getElementById('dbPassword')?.value || '';
  if (!name || !phone || !password) { errDiv.textContent = 'All fields required.'; errDiv.classList.remove('hidden'); return; }
  try {
    const res  = await apiFetch(`${API}/delivery/boys`, { method:'POST', body: JSON.stringify({ name, phone, password }) });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showToast('Delivery boy added ✓', 'success');
    closeModal('addDeliveryModal');
    loadDeliveryBoys();
  } catch (err) { errDiv.textContent = err.message; errDiv.classList.remove('hidden'); }
});

async function removeDeliveryBoy(id, name) {
  if (!confirm(`Remove "${name}" from delivery team?`)) return;
  try {
    const res  = await apiFetch(`${API}/delivery/boys/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showToast('Delivery boy removed', 'success');
    loadDeliveryBoys();
  } catch (err) { showToast(err.message, 'error'); }
}

if (page === 'delivery-boys') adminAuthRehydrate().then(function(ok) { if (ok) loadDeliveryBoys(); });
