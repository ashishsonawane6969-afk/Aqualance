/* ═══════════════════════════════════════════════════════════════
   product.js — Product Detail Page
   Features: swipe gallery, smooth image transitions, sticky CTA,
   loading states, structured API response, touch-friendly controls,
   bundle product display, full-width stock bar.
   Requires app.js to be loaded first.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const _productAPI = 'https://aqualance-production.up.railway.app/api/v1';

/* ── Safe HTML escape ──────────────────────────────────────── */
function _esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}

function _disc(price, mrp) {
  if (!mrp || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

const _CE = {
  'Face Care': '💆', 'Hair Care': '💇', 'Body Care': '🧴',
  'Essentials': '🧼', 'New Launches': '✨', 'General': '📦'
};

/* ── Gallery state ─────────────────────────────────────────── */
let _imgs      = [];
let _activeIdx = 0;
let _touchStartX = 0;
let _touchEndX   = 0;

function _buildGallery(p) {
  _imgs = [];
  if (p.image && p.image.trim()) _imgs.push(p.image.trim());
  try {
    const extras = JSON.parse(p.images || '[]');
    if (Array.isArray(extras)) {
      extras.forEach(u => { if (u && !_imgs.includes(u)) _imgs.push(u); });
    }
  } catch (e) { /* skip bad JSON */ }
  _activeIdx = 0;
}

/* ── Set active gallery image with fade transition ─────────── */
function _setActiveImage(idx) {
  _activeIdx = Math.max(0, Math.min(_imgs.length - 1, idx));
  const mainImg = document.getElementById('pdMainImg');
  const emoji   = document.getElementById('pdMainEmoji');

  if (!_imgs.length) {
    if (mainImg) mainImg.style.display = 'none';
    if (emoji)   emoji.style.display   = 'flex';
    return;
  }

  if (mainImg) {
    mainImg.style.opacity    = '0';
    mainImg.style.transition = 'opacity .2s ease';
    setTimeout(() => {
      mainImg.src = _imgs[_activeIdx];
      mainImg.style.display = '';
      if (emoji) emoji.style.display = 'none';
      requestAnimationFrame(() => { mainImg.style.opacity = '1'; });
    }, 160);
  }

  document.querySelectorAll('.pd-thumb').forEach((el, i) => {
    el.classList.toggle('active', i === _activeIdx);
    el.setAttribute('aria-pressed', String(i === _activeIdx));
  });
  document.querySelectorAll('.pd-dot').forEach((el, i) => {
    el.classList.toggle('active', i === _activeIdx);
  });
}

/* ── Navigate prev/next ────────────────────────────────────── */
function _prevImage() {
  if (!_imgs.length) return;
  _setActiveImage((_activeIdx - 1 + _imgs.length) % _imgs.length);
}
function _nextImage() {
  if (!_imgs.length) return;
  _setActiveImage((_activeIdx + 1) % _imgs.length);
}

/* ── Render thumbnails ─────────────────────────────────────── */
function _renderThumbs() {
  const wrap = document.getElementById('pdThumbs');
  if (!wrap) return;
  if (_imgs.length <= 1) { wrap.style.display = 'none'; return; }

  wrap.innerHTML = _imgs.map((src, i) =>
    `<button class="pd-thumb${i === 0 ? ' active' : ''}"
      onclick="_setActiveImage(${i})"
      aria-label="View image ${i + 1}"
      aria-pressed="${i === 0 ? 'true' : 'false'}">
      <img src="${_esc(src)}" alt="Product view ${i + 1}" loading="lazy"
        onerror="this.closest('.pd-thumb').style.display='none'">
    </button>`
  ).join('');
}

/* ── Swipe / touch gesture for gallery ────────────────────── */
function _initGallerySwipe() {
  const wrap = document.getElementById('pdMainImgWrap');
  if (!wrap || _imgs.length <= 1) return;

  wrap.addEventListener('touchstart', e => {
    _touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  wrap.addEventListener('touchend', e => {
    _touchEndX = e.changedTouches[0].screenX;
    const diff = _touchStartX - _touchEndX;
    if (Math.abs(diff) > 40) {
      diff > 0 ? _nextImage() : _prevImage();
    }
  }, { passive: true });

  wrap.setAttribute('tabindex', '0');
  wrap.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  _prevImage();
    if (e.key === 'ArrowRight') _nextImage();
  });

  const arrowHTML = `
    <button class="pd-gallery-arrow pd-gallery-prev" onclick="_prevImage()" aria-label="Previous image">&#8249;</button>
    <button class="pd-gallery-arrow pd-gallery-next" onclick="_nextImage()" aria-label="Next image">&#8250;</button>`;
  wrap.insertAdjacentHTML('beforeend', arrowHTML);
}

/* ── Qty picker ────────────────────────────────────────────── */
let _pdQty = 1;

function _setQty(val) {
  _pdQty = Math.max(1, Math.min(99, val));
  const el = document.getElementById('pdQtyVal');
  if (el) el.textContent = _pdQty;
}

/* ── Specs table ───────────────────────────────────────────── */
function _renderSpecs(p) {
  const wrap = document.getElementById('pdSpecs');
  if (!wrap) return;

  const rows = [];
  if (p.category) rows.push(['Category', p.category]);

  // Bundle pack config
  if (p.is_bundle && p.display_name) {
    rows.push(['Pack Config', p.display_name]);
    if (p.base_quantity && p.pack_size && p.base_unit) {
      const total = parseFloat(p.base_quantity) * parseInt(p.pack_size, 10);
      rows.push(['Total Quantity', total + ' ' + p.base_unit]);
    }
  } else if (p.unit) {
    rows.push(['Unit / Pack', p.unit]);
  }

  if (typeof p.stock !== 'undefined') {
    rows.push(['Availability',
      p.stock === 0  ? 'Out of Stock' :
      p.stock >= 999 ? 'In Stock' :
      `${p.stock} units left`
    ]);
  }
  if (p.mrp && p.mrp > p.price) {
    const d = _disc(p.price, p.mrp);
    rows.push(['MRP',      '₹' + parseFloat(p.mrp).toFixed(2)]);
    rows.push(['You Save', '₹' + (parseFloat(p.mrp) - parseFloat(p.price)).toFixed(2) + ` (${d}% off)`]);
  }
  if (p.created_at) {
    const dt = new Date(p.created_at);
    rows.push(['Listed', dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })]);
  }

  if (!rows.length) {
    const sec = wrap.closest('.pd-specs-section');
    if (sec) sec.style.display = 'none';
    return;
  }

  wrap.innerHTML = rows.map(r =>
    `<div class="pd-spec-row">
       <span class="pd-spec-key">${_esc(r[0])}</span>
       <span class="pd-spec-val">${_esc(String(r[1]))}</span>
     </div>`
  ).join('');
}

/* ── Add to cart ───────────────────────────────────────────── */
function _pdAddToCart(product) {
  if (!product || product.stock === 0) return;
  const cart  = getCart();
  const found = cart.find(i => i.id === product.id);
  if (found) found.quantity += _pdQty;
  else cart.push(Object.assign({}, product, { quantity: _pdQty }));
  saveCart(cart);
  updateCartBadge();

  const btn = document.getElementById('pdAddToCartBtn');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ Added!';
    btn.disabled  = true;
    setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1800);
  }

  showToast(`${product.name} × ${_pdQty} added to cart ✓`, 'success');
}

/* ── Skeleton while loading ────────────────────────────────── */
function _showSkeleton() {
  const w = document.getElementById('pdWrap');
  if (!w) return;
  w.innerHTML = `<div class="pd-layout">
    <div class="pd-gallery-col">
      <div class="pd-main-img-wrap skeleton" style="aspect-ratio:1"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <div class="skeleton" style="width:64px;height:64px;border-radius:var(--r-sm)"></div>
        <div class="skeleton" style="width:64px;height:64px;border-radius:var(--r-sm)"></div>
        <div class="skeleton" style="width:64px;height:64px;border-radius:var(--r-sm)"></div>
      </div>
    </div>
    <div class="pd-info-col" style="padding-top:4px">
      <div class="skeleton" style="height:13px;width:90px;border-radius:4px;margin-bottom:14px"></div>
      <div class="skeleton" style="height:26px;width:88%;border-radius:4px;margin-bottom:8px"></div>
      <div class="skeleton" style="height:26px;width:68%;border-radius:4px;margin-bottom:20px"></div>
      <div class="skeleton" style="height:20px;width:52%;border-radius:4px;margin-bottom:26px"></div>
      <div class="skeleton" style="height:13px;width:100%;border-radius:4px;margin-bottom:7px"></div>
      <div class="skeleton" style="height:13px;width:92%;border-radius:4px;margin-bottom:7px"></div>
      <div class="skeleton" style="height:13px;width:76%;border-radius:4px;margin-bottom:32px"></div>
      <div class="skeleton" style="height:50px;width:100%;border-radius:999px"></div>
    </div>
  </div>`;
}

/* ── Error state ───────────────────────────────────────────── */
function _showError(msg) {
  const w = document.getElementById('pdWrap');
  if (!w) return;
  w.innerHTML = `<div class="empty-state" style="padding:60px 20px;grid-column:1/-1">
    <div class="icon">😕</div>
    <h3>Product not found</h3>
    <p>${_esc(msg)}</p>
    <a href="index.html" class="btn btn-primary" style="margin-top:16px">← Back to Products</a>
  </div>`;
}

/* ── Render full product page ──────────────────────────────── */
function _renderProduct(p) {
  const w = document.getElementById('pdWrap');
  if (!w) return;

  _buildGallery(p);

  const disc   = _disc(p.price, p.mrp);
  const emoji  = _CE[p.category] || '📦';
  const oos    = p.stock === 0;
  const inCart = getCart().find(c => c.id === p.id);
  const cartQty = inCart ? inCart.quantity : 0;

  document.title = `${p.name} — Aqualence Ventures`;

  // Safe product JSON for onclick handlers
  const pSafe = JSON.stringify(p)
    .replace(/"/g, '&quot;').replace(/</g, '&#60;')
    .replace(/>/g, '&#62;').replace(/'/g, '&#39;');

  // Main image HTML
  const mainImgHTML = _imgs.length
    ? `<img id="pdMainImg" src="${_esc(_imgs[0])}" alt="${_esc(p.name)}"
        style="transition:opacity .2s ease"
        onerror="this.style.display='none';document.getElementById('pdMainEmoji').style.display='flex'">`
    : '';

  const emojiDisplay = _imgs.length ? 'none' : 'flex';

  // Discount badge (top-left corner of image)
  const discBadge = disc > 0
    ? `<span class="pd-discount-badge">-${disc}%</span>`
    : '';

  // Price row
  let priceHTML = `<span class="pd-price">₹${parseFloat(p.price).toFixed(2)}</span>`;
  if (p.mrp && p.mrp > p.price) {
    priceHTML += `<span class="pd-mrp">₹${parseFloat(p.mrp).toFixed(2)}</span>
                  <span class="pd-save-badge">${disc}% off</span>`;
  }

  // Stock bar — full-width pill matching the screenshot
  const stockBarHTML = oos
    ? `<div class="pd-stock-bar pd-stock-bar--oos">❌ Out of Stock</div>`
    : `<div class="pd-stock-bar pd-stock-bar--in">✅ In Stock</div>`;

  // Description section
  const descSection = p.description
    ? `<div class="pd-desc-section">
         <h3 class="pd-section-title">About this product</h3>
         <p class="pd-desc">${_esc(p.description)}</p>
       </div>`
    : '';

  // Bundle display name pill (shown above specs if bundle product)
  const bundlePillHTML = (p.is_bundle && p.display_name)
    ? `<div class="pd-bundle-pill-wrap">
         <span class="pd-bundle-pill">${_esc(p.display_name)}</span>
       </div>`
    : '';

  // Cart / CTA section
  let cartSection;
  if (oos) {
    cartSection = `<button class="btn btn-ghost btn-lg btn-full pd-oos-btn" disabled>
      ❌ Out of Stock</button>`;
  } else {
    const alreadyMsg = cartQty > 0
      ? `<p class="pd-already-in-cart">Already in cart: <strong>${cartQty}</strong></p>`
      : '';
    cartSection = `
      <div class="pd-cart-row">
        <div class="pd-nav-btns">
          <a href="/index.html" class="btn btn-outline btn-sm">← Continue</a>
          <a href="/cart.html" class="btn btn-ghost btn-sm">🛒 View Cart</a>
        </div>
        <div class="pd-qty-atc">
          <div class="pd-qty-control">
            <button class="pd-qty-btn" onclick="_setQty(_pdQty-1)" aria-label="Decrease quantity">−</button>
            <span class="pd-qty-val" id="pdQtyVal" aria-live="polite">1</span>
            <button class="pd-qty-btn" onclick="_setQty(_pdQty+1)" aria-label="Increase quantity">+</button>
          </div>
          <button class="btn pd-atc-btn" id="pdAddToCartBtn"
            onclick="_pdAddToCart(${pSafe})">🛒 Add to Cart</button>
        </div>
      </div>
      ${alreadyMsg}`;
  }

  // Full render
  w.innerHTML = `<div class="pd-layout">

    <!-- Gallery column -->
    <div class="pd-gallery-col">
      <div class="pd-main-img-wrap" id="pdMainImgWrap" role="img"
        aria-label="${_esc(p.name)} image gallery. Use arrow keys or swipe to navigate.">
        ${mainImgHTML}
        <span id="pdMainEmoji"
          style="font-size:4rem;display:${emojiDisplay};align-items:center;justify-content:center;width:100%;height:100%">
          ${emoji}
        </span>
        ${discBadge}
      </div>
      <div class="pd-thumbs" id="pdThumbs" role="tablist" aria-label="Product images"></div>
    </div>

    <!-- Info column -->
    <div class="pd-info-col">

      <div class="pd-category">
        ${emoji} ${_esc(p.category)}
        ${p.category === 'New Launches' ? '<span class="pd-new-badge">New Launch</span>' : ''}
      </div>

      <h1 class="pd-name">${_esc(p.name)}</h1>

      <div class="pd-price-row">${priceHTML}</div>

      ${stockBarHTML}

      ${descSection}

      ${bundlePillHTML}

      <div class="pd-specs-section">
        <h3 class="pd-section-title">Product Details</h3>
        <div id="pdSpecs" class="pd-specs"></div>
      </div>

      ${cartSection}

    </div>

  </div>`;

  // Post-render hooks
  _renderThumbs();
  _renderSpecs(p);
  _initGallerySwipe();
  updateCartBadge();

  // Sync header elements
  const hdr = document.getElementById('pdHeaderTitle');
  const bc  = document.getElementById('pdBreadcrumbName');
  if (hdr) hdr.textContent = p.name.length > 22 ? p.name.slice(0, 20) + '…' : p.name;
  if (bc)  bc.textContent  = p.name;
}

/* ── Inject dynamic styles once ───────────────────────────── */
function _injectProductStyles() {
  if (document.getElementById('pdDynamicStyles')) return;
  const style = document.createElement('style');
  style.id = 'pdDynamicStyles';
  style.textContent = `
    /* ── Gallery arrows ─────────────────────────────────── */
    .pd-gallery-arrow {
      position: absolute; top: 50%; transform: translateY(-50%);
      z-index: 10; width: 36px; height: 36px; border-radius: 50%;
      background: rgba(255,255,255,.88); border: 1px solid rgba(0,0,0,.1);
      font-size: 1.4rem; font-weight: 700; color: #333;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: all .15s; box-shadow: 0 2px 8px rgba(0,0,0,.15);
      touch-action: manipulation; -webkit-tap-highlight-color: transparent;
    }
    .pd-gallery-arrow:active { background:#fff; transform:translateY(-50%) scale(.92); }
    .pd-gallery-prev { left: 10px; }
    .pd-gallery-next { right: 10px; }
    @media (max-width: 480px) {
      .pd-gallery-arrow { width:32px; height:32px; font-size:1.1rem; }
    }

    /* ── Full-width stock bar (replaces pill badge) ──────── */
    .pd-stock-bar {
      display: flex;
      align-items: center;
      width: 100%;
      padding: 8px 14px;
      border-radius: var(--r-sm);
      font-size: .8rem;
      font-weight: 700;
      margin-bottom: 18px;
      letter-spacing: .01em;
    }
    .pd-stock-bar--in {
      background: var(--success-pale);
      color: var(--success);
      border: 1px solid rgba(30,125,58,.15);
    }
    .pd-stock-bar--oos {
      background: var(--error-pale);
      color: var(--error);
      border: 1px solid rgba(192,57,43,.15);
    }

    /* ── Add-to-cart button — dark navy pill ─────────────── */
    .pd-atc-btn {
      background: var(--ink);
      color: #fff;
      border: none;
      border-radius: var(--r-full);
      padding: 0 22px;
      min-height: 52px;
      font-size: .92rem;
      font-weight: 700;
      letter-spacing: .01em;
      white-space: nowrap;
      cursor: pointer;
      transition: background .15s, transform .1s;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .pd-atc-btn:hover { background: var(--ink-mid); }
    .pd-atc-btn:active { transform: scale(.97); }
    .pd-atc-btn:disabled {
      background: var(--border-dark);
      cursor: not-allowed;
      transform: none;
    }

    /* ── Bundle display-name pill ───────────────────────── */
    .pd-bundle-pill-wrap {
      margin-bottom: 20px;
    }
    .pd-bundle-pill {
      display: inline-block;
      padding: 9px 24px;
      border-radius: 8px;
      font-size: .88rem;
      font-weight: 700;
      letter-spacing: .03em;
      color: #fff;
      background: var(--ink);
      border: 2px solid var(--ink);
    }

    /* ── Section title styling ───────────────────────────── */
    .pd-section-title {
      font-size: .65rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .1em;
      color: var(--ink-soft);
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1.5px solid var(--border);
    }
  `;
  document.head.appendChild(style);
}

/* ── Main entry: load product by ?id= ─────────────────────── */
(async function loadProductDetail() {
  _injectProductStyles();

  const params = new URLSearchParams(window.location.search);
  const id     = params.get('id');

  if (!id || isNaN(parseInt(id, 10))) {
    _showError('No product ID was provided in the URL.');
    return;
  }

  _showSkeleton();

  try {
    const controller = new AbortController();
    const _adaptTimeout = (window.AqNet && window.AqNet.quality) ? window.AqNet.quality.timeout() : 20000;
    const timeout    = setTimeout(() => controller.abort(), _adaptTimeout);

    const _fetcher = (window.AqNet && window.AqNet.fetch) ? window.AqNet.fetch : fetch;
    const res  = await _fetcher(`${_productAPI}/products/${encodeURIComponent(id)}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const json = await res.json();

    if (!json.success || !json.data) throw new Error(json.message || 'Product not found');

    _renderProduct(json.data);

  } catch (err) {
    if (err.name === 'AbortError') {
      _showError('Request timed out. Please check your connection and try again.');
    } else {
      _showError('Could not load product details. Please try again.');
    }
    console.error('[product.js]', err);
  }
}());
