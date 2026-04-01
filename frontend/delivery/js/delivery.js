/* ─── delivery.js ─────────────────────────────────────────── */
const API = 'https://aqualance-production.up.railway.app/api/v1';

/* ── XSS Guard: escape all DB values before inserting into innerHTML ────── */
// Any field that originated from user input (shop_name, customer_name, address,
// notes, product_name, etc.) must be escaped before being written to innerHTML.
// Using createTextNode is the safest approach — no regex to maintain.
function _esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str != null ? String(str) : ''));
  return d.innerHTML;
}

/* ── Auth ─────────────────────────────────────────────────── */
// Fix 2: Token is in httpOnly cookie — JS cannot read it.
function getDeliveryUser() {
  try { return JSON.parse(sessionStorage.getItem('aq_delivery_user') || 'null'); }
  catch { return null; }
}

async function deliveryAuthRehydrate() {
  // Auth gate in network.js handles rehydration — just wait for it
  if (window._aqAuthReady) await window._aqAuthReady.catch(function(){});
  return !!getDeliveryUser();
}
function authHeader() {
  // No Authorization header — cookie sent automatically via credentials:'include'
  return { 'Content-Type': 'application/json' };
}
var _deliveryLoggingOut = false;
async function deliveryLogout() {
  if (_deliveryLoggingOut) return;
  _deliveryLoggingOut = true;
  try {
    await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'include' });
  } catch (_) { /* best-effort */ }
  sessionStorage.removeItem('aq_delivery_user');
  window.location.replace('/delivery/login.html');
}
window.deliveryLogout = deliveryLogout;
window.deliveryAuthRehydrate = deliveryAuthRehydrate;

/* ── Fetch wrapper: auto-redirect on session expiry ──────── */
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    credentials: 'include',   // Fix 2: send httpOnly cookie
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

function openModal(id) { document.getElementById(id)?.classList.add('show'); }
function closeModal(id){ document.getElementById(id)?.classList.remove('show'); }

function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }
function statusBadge(s) { return `<span class="status status-${s}">${s.replace('_',' ')}</span>`; }

/* ─────────────────────────────────────────────────────────────
   LOGIN PAGE
───────────────────────────────────────────────────────────── */
const page = window.location.pathname.split('/').pop().replace('.html', '');

if (page === 'login') {
  if (getDeliveryUser()) window.location.replace('/delivery/dashboard.html');  // fast UX redirect

  document.getElementById('deliveryLoginForm')?.addEventListener('submit', async e => {
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
          phone:    document.getElementById('phone').value.trim(),
          password: document.getElementById('password').value,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message);

      if (data.mfa_required) {
        throw new Error('Multi-factor authentication required. Please complete MFA or contact your administrator.');
      }
      if (data.otp_required) {
        throw new Error('SMS OTP required. Please complete OTP or contact your administrator.');
      }

      if (!data.user) throw new Error('Login response missing user profile.');
      if (data.user.role !== 'delivery') throw new Error('This portal is for delivery partners only.');

      // Fix 2: Token is in httpOnly cookie — store only user profile
      sessionStorage.setItem('aq_delivery_user', JSON.stringify(data.user));
      // Fix 4: Force password change if required
      if (data.user.must_change_password) {
        window.location.replace('/delivery/change-password.html');
        return;
      }
      window.location.replace('/delivery/dashboard.html');
    } catch (err) {
      errDiv.textContent = err.message;
      errDiv.classList.remove('hidden');
      btn.textContent = 'Login'; btn.disabled = false;
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   DASHBOARD PAGE
───────────────────────────────────────────────────────────── */
let myOrders = [];
let activeFilter = 'all';

if (page === 'dashboard') {
  deliveryAuthRehydrate().then(ok => {
    if (!ok) return;
    const user = getDeliveryUser();
    const nameEl = document.getElementById('sidebarName');
    if (nameEl && user) nameEl.textContent = user.name;

    // Close modal on backdrop click
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => { if (e.target === el) el.classList.remove('show'); });
    });

    loadMyOrders();
  });
}

async function loadMyOrders() {
  const user = getDeliveryUser();
  if (!user) return;
  const container = document.getElementById('ordersContainer');
  if (container) container.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
  try {
    const res = await apiFetch(`${API}/delivery/orders/${user.id}`);
    myOrders = (await res.json()).data || [];
    renderOrders();
  } catch (err) {
    if (container) container.innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>Failed to load orders</h3><p>Could not load orders. Please retry.</p></div>';
  }
}

function filterDeliveries(status, btn) {
  activeFilter = status;
  document.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderOrders();
}

function renderOrders() {
  const container = document.getElementById('ordersContainer');
  if (!container) return;

  // Update stat boxes
  const total     = myOrders.length;
  const pending   = myOrders.filter(o => o.status === 'assigned' || o.status === 'out_for_delivery').length;
  const delivered = myOrders.filter(o => o.status === 'delivered').length;
  const el1 = document.getElementById('statTotal');
  const el2 = document.getElementById('statPending');
  const el3 = document.getElementById('statDone');
  if (el1) el1.textContent = total;
  if (el2) el2.textContent = pending;
  if (el3) el3.textContent = delivered;

  const filtered = activeFilter === 'all' ? myOrders : myOrders.filter(o => o.status === activeFilter);

  if (!filtered.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📭</div><h3>No orders</h3><p>${activeFilter === 'all' ? 'You have no assigned deliveries yet.' : 'No orders with this status.'}</p></div>`;
    return;
  }

  container.innerHTML = filtered.map(order => {
    const hasCoords = order.latitude && order.longitude;
    const mapsUrl   = hasCoords
      ? `https://www.google.com/maps?q=${order.latitude},${order.longitude}`
      : `https://www.google.com/maps/search/${encodeURIComponent(order.address + ' ' + order.city)}`;

    return `
      <div class="order-tile">
        <div class="order-tile-header">
          <div>
            <div class="order-ref-sm">${order.order_number}</div>
            <div style="font-size:.78rem;color:var(--ink-soft);margin-top:2px">${new Date(order.created_at).toLocaleDateString('en-IN')}</div>
          </div>
          ${statusBadge(order.status)}
        </div>
        <div class="order-tile-body">
          <div>🏪 <strong>${order.shop_name}</strong> — ${order.customer_name}</div>
          <div>📞 <a href="tel:${order.phone}" style="color:var(--sage); font-weight:600">${order.phone}</a></div>
          <div>📍 ${order.address}, ${order.city} — ${order.pincode}</div>
          <div style="font-weight:700; color:var(--sage); margin-top:4px">💰 ₹${parseFloat(order.total_price).toFixed(2)}</div>
        </div>
        <div class="order-tile-footer">
          <a href="${mapsUrl}" target="_blank" class="map-btn">
            🗺️ Navigate
          </a>
          <button class="btn btn-outline btn-sm" onclick="viewDeliveryOrder(${order.id})">
            📋 Details
          </button>
          ${order.status === 'assigned'
            ? `<button class="transit-btn" onclick="markInTransit(${order.id})">🚴 In Transit</button>`
            : ''
          }
          ${order.status !== 'delivered' && order.status !== 'cancelled'
            ? `<button class="deliver-btn" onclick="markDelivered(${order.id})">✅ Mark Delivered</button>`
            : ''
          }
        </div>
      </div>`;
  }).join('');
}

async function viewDeliveryOrder(orderId) {
  openModal('orderDetailModal');
  document.getElementById('deliveryOrderDetail').innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';
  const user = getDeliveryUser();
  try {
    const res  = await apiFetch(`${API}/delivery/orders/${user.id}/${orderId}`);
    const data = (await res.json()).data;
    const hasCoords = data.latitude && data.longitude;
    const mapsUrl   = hasCoords
      ? `https://www.google.com/maps?q=${data.latitude},${data.longitude}`
      : `https://www.google.com/maps/search/${encodeURIComponent(data.address + ' ' + data.city)}`;

    document.getElementById('deliveryOrderDetail').innerHTML = `
      <div style="background:var(--sage-pale);border-radius:var(--radius-sm);padding:16px;margin-bottom:16px;">
        <div style="font-size:.8rem;color:var(--sage);font-weight:700;margin-bottom:8px">📋 ${_esc(data.order_number)} — ${statusBadge(data.status)}</div>
        <div style="font-size:.88rem;line-height:1.8">
          <div>🏪 <strong>${_esc(data.shop_name)}</strong></div>
          <div>👤 ${_esc(data.customer_name)}</div>
          <div>📞 <a href="tel:${_esc(data.phone)}" style="color:var(--sage);font-weight:600">${_esc(data.phone)}</a></div>
          <div>📍 ${_esc(data.address)}, ${_esc(data.city)} — ${_esc(data.pincode)}</div>
          ${data.notes ? `<div>📝 ${_esc(data.notes)}</div>` : ''}
        </div>
      </div>

      <strong style="font-size:.88rem">Items to Deliver:</strong>
      <div style="margin-top:10px;">
        ${(data.items || []).map(i => `
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:.85rem;">
            <span>${_esc(i.product_name)} <span style="color:var(--ink-soft)">× ${i.quantity}</span></span>
            <span style="font-weight:600">₹${(i.price * i.quantity).toFixed(2)}</span>
          </div>`).join('')}
        <div style="text-align:right;font-weight:700;color:var(--sage);margin-top:8px">
          Total: ₹${parseFloat(data.total_price).toFixed(2)}
        </div>
      </div>

      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;">
        <a href="${mapsUrl}" target="_blank" class="map-btn" style="flex:1;justify-content:center;">
          🗺️ Open in Google Maps
        </a>
        ${data.status === 'assigned'
          ? `<button class="transit-btn" style="flex:1;" onclick="markInTransit(${data.id})">🚴 Mark In Transit</button>`
          : ''
        }
        ${data.status !== 'delivered' && data.status !== 'cancelled'
          ? `<button class="deliver-btn" style="flex:1;" onclick="markDelivered(${data.id})">✅ Mark as Delivered</button>`
          : ''
        }
      </div>
    `;
  } catch { document.getElementById('deliveryOrderDetail').textContent = 'Failed to load details.'; }
}

async function markDelivered(orderId) {
  if (!confirm('Mark this order as delivered?')) return;
  try {
    const res  = await apiFetch(`${API}/orders/update-status`, {
      method: 'PUT',
      body: JSON.stringify({ order_id: orderId, status: 'delivered' }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showToast('Order marked as delivered! ✅', 'success');
    closeModal('orderDetailModal');
    loadMyOrders();
  } catch (err) { showToast(err.message, 'error'); }
}

async function markInTransit(orderId) {
  try {
    const res  = await apiFetch(`${API}/orders/update-status`, {
      method: 'PUT',
      body: JSON.stringify({ order_id: orderId, status: 'out_for_delivery' }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    showToast('Order marked as in transit 🚴', 'success');
    closeModal('orderDetailModal');
    loadMyOrders();
  } catch (err) { showToast(err.message, 'error'); }
}
