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

/* ── Simple HTML escaper to prevent XSS ── */
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

  // ✅ FIX: Check for HTTPS — mobile browsers (especially iOS Safari) block
  // geolocation on non-secure origins. Without this check, the API silently
  // fails or returns POSITION_UNAVAILABLE with no useful message.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    btn.textContent = '📍 GPS';
    btn.disabled = false;
    showToast('Location requires a secure connection (HTTPS). Please enter manually.', 'error');
    return;
  }

  if (!navigator.geolocation) {
    btn.textContent = '📍 GPS';
    btn.disabled = false;
    showToast('Geolocation is not supported by your browser. Please enter manually.', 'error');
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
    err => {
      btn.textContent = '📍 GPS';
      btn.disabled = false;

      // ✅ FIX: iOS Safari returns error code 2 (POSITION_UNAVAILABLE) when
      // location services are OFF at the system level — not code 1 (DENIED).
      // Without iOS-specific guidance, users never know to check Settings.
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isAndroid = /Android/.test(navigator.userAgent);

      const msgs = {
        // PERMISSION_DENIED
        1: isIOS
          ? 'Location denied. Go to Settings → Privacy & Security → Location Services → Safari → "While Using".'
          : isAndroid
            ? 'Location denied. Tap the 🔒 lock icon in Chrome address bar → Site settings → Location → Allow.'
            : 'Location permission denied. Allow location access in your browser settings.',
        // POSITION_UNAVAILABLE — iOS uses this when Location Services is OFF system-wide
        2: isIOS
          ? 'Location unavailable. Check Settings → Privacy & Security → Location Services is ON, then try again.'
          : 'Location unavailable. Make sure GPS/Location is enabled on your device, or enter manually.',
        // TIMEOUT
        3: 'Location timed out. Move to an area with better signal and try again, or enter manually.',
      };

      showToast(msgs[err.code] || 'Could not get location. Please enter coordinates manually.', 'error');
    },
    {
      // ✅ FIX: enableHighAccuracy:true uses GPS on mobile (not just Wi-Fi/cell tower).
      // Increased timeout to 20s — GPS cold-start on mobile can take 10-15s.
      // maximumAge:30000 — accept a position up to 30s old to speed up repeat taps.
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 30000,
    }
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
    products: cart.map(i => ({ id: i.id, quantity: i.quantity })),
  };

  try {
    const _timeout = (window.AqNet && window.AqNet.quality) ? window.AqNet.quality.timeout() : 20000;
    const _ctrl    = new AbortController();
    const _tid     = setTimeout(() => _ctrl.abort(), _timeout);
    const _fetcher = (window.AqNet && window.AqNet.fetch) ? window.AqNet.fetch : fetch;
    const res = await _fetcher('https://aqualance-production-9e22.up.railway.app/api/v1/orders', {
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
