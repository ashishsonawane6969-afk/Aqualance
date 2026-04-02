/* ─── checkout.js ─────────────────────────────────────────── */

function renderReview() {
  const cart  = getCart();
  const items = document.getElementById('reviewItems');
  const total = document.getElementById('reviewTotal');
  

  
  if (!items) return;

  if (!cart.length) {
    window.location.href = 'cart.html';
    return;
  }

  items.innerHTML = cart.map(i => `
    <div class="review-item">
      <span class="review-item-name">${escapeHtml(i.name)} × ${i.quantity}</span>
      <span class="review-item-price">₹${(i.price * i.quantity).toFixed(2)}</span>
    </div>`).join('');

  if (total) total.textContent = `₹${cartTotal().toFixed(2)}`;
}

/* ── Simple HTML escaper to prevent XSS in rendered content ── */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str || ''));
  return div.innerHTML;
}

/* ── Auto-detect location ─────────────────────────────────── */
document.getElementById('getLocationBtn')?.addEventListener('click', () => {
  const btn = document.getElementById('getLocationBtn');
  btn.textContent = '⏳';
  btn.disabled = true;
  if (!navigator.geolocation) {
    btn.textContent = '📍 Auto';
    btn.disabled = false;
    showToast('Geolocation not supported by your browser.', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      document.getElementById('latitude').value  = pos.coords.latitude.toFixed(6);
      document.getElementById('longitude').value = pos.coords.longitude.toFixed(6);
      btn.textContent = '✅';
      btn.disabled = false;
      showToast('Location captured!', 'success');
    },
    () => {
      btn.textContent = '📍 Auto';
      btn.disabled = false;
      showToast('Could not get location. Please enter manually.', 'error');
    },
    { timeout: 10000 }
  );
});

/* ── Form validation ──────────────────────────────────────── */
function validate() {
  const fields = ['customer_name','shop_name','phone','address','city','pincode'];
  let ok = true;
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (!el.value.trim()) { el.classList.add('error'); ok = false; }
    else                  { el.classList.remove('error'); }
  });
  const phone = document.getElementById('phone')?.value.trim();
  if (phone && !/^[6-9]\d{9}$/.test(phone)) {
    document.getElementById('phone').classList.add('error');
    ok = false;
  }
  const pincode = document.getElementById('pincode')?.value.trim();
  if (pincode && !/^\d{6}$/.test(pincode)) {
    document.getElementById('pincode').classList.add('error');
    ok = false;
  }
  return ok;
}

/* ── Submit order ─────────────────────────────────────────── */
document.getElementById('checkoutForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const errDiv = document.getElementById('formError');
  errDiv.classList.add('hidden');

  if (!validate()) {
    errDiv.textContent = 'Please fill in all required fields correctly.';
    errDiv.classList.remove('hidden');
    return;
  }

  const cart = getCart();
  if (!cart.length) {
    errDiv.textContent = 'Your cart is empty.';
    errDiv.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('placeOrderBtn');
  btn.textContent = '⏳ Placing Order...';
  btn.disabled    = true;

  const latVal = document.getElementById('latitude').value;
  const lngVal = document.getElementById('longitude').value;

  const payload = {
    customer_name: document.getElementById('customer_name').value.trim(),
    shop_name:     document.getElementById('shop_name').value.trim(),
    phone:         document.getElementById('phone').value.trim(),
    address:       document.getElementById('address').value.trim(),
    city:          document.getElementById('city').value.trim(),
    pincode:       document.getElementById('pincode').value.trim(),
    latitude:      latVal ? parseFloat(latVal) : null,
    longitude:     lngVal ? parseFloat(lngVal) : null,
    notes:         document.getElementById('notes')?.value.trim() || '',
    // Send only IDs and quantities — server determines price from DB
    products: cart.map(i => ({ id: i.id, quantity: i.quantity })),
  };

  try {
    const _timeout = (window.AqNet && window.AqNet.quality) ? window.AqNet.quality.timeout() : 20000;
    const _ctrl    = new AbortController();
    const _tid     = setTimeout(() => _ctrl.abort(), _timeout);
    const _fetcher = (window.AqNet && window.AqNet.fetch) ? window.AqNet.fetch : fetch;
     // frontend/js/checkout.js — use the absolute URL explicitly
const res = await _fetcher('https://aqualance-production.up.railway.app/api/v1/orders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  _ctrl.signal,
    });
    clearTimeout(_tid);
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    saveCart([]);
    window.location.href = `order-success.html?ref=${encodeURIComponent(data.order_number)}`;
  } catch (err) {
    errDiv.textContent = err.message || 'Something went wrong. Please try again.';
    errDiv.classList.remove('hidden');
    btn.textContent = '✅ Place Order';
    btn.disabled    = false;
  }
});

renderReview();
