/* ═══════════════════════════════════════════════════════════════
   product.js — Product Detail Page
   Features: swipe gallery, smooth image transitions, sticky CTA,
   loading states, structured API response, touch-friendly controls,
   bundle product display, full-width stock bar,
   VARIANT SELECTOR (size/pack picker → cart).
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

  /* Backend returns p.images already parsed as an array (via _parseImages).
     Guard against both array and JSON-string forms so it works either way. */
  let extras = p.images;
  if (typeof extras === 'string') {
    try { extras = JSON.parse(extras); } catch (e) { extras = []; }
  }
  if (Array.isArray(extras)) {
    extras.forEach(u => { if (u && u.trim() && !_imgs.includes(u.trim())) _imgs.push(u.trim()); });
  }

  _activeIdx = 0;
}

/* ── Set active gallery image with fade transition ─────────── */
function _setActiveImage(idx) {
  if (!_imgs.length) return;
  _activeIdx = ((idx % _imgs.length) + _imgs.length) % _imgs.length;

  const mainImg = document.getElementById('pdMainImg');
  const emoji   = document.getElementById('pdMainEmoji');
  if (!mainImg) return;

  const newSrc = _imgs[_activeIdx];

  /* Fade out, swap, fade back in — with onload fallback so it
     never gets stuck invisible */
  mainImg.style.transition = 'opacity .18s ease';
  mainImg.style.opacity    = '0';

  setTimeout(() => {
    mainImg.src           = newSrc;
    mainImg.style.display = 'block';
    if (emoji) emoji.style.display = 'none';

    const fadeIn = () => {
      mainImg.style.opacity = '1';
      mainImg.onload = null;
      mainImg.onerror = null;
    };
    /* Fire as soon as image is decoded, or after 600ms worst case */
    if (mainImg.complete) {
      fadeIn();
    } else {
      mainImg.onload  = fadeIn;
      mainImg.onerror = fadeIn;
      setTimeout(fadeIn, 600);
    }
  }, 180);

  /* Update thumbnail active ring */
  document.querySelectorAll('.pd-thumb').forEach((el, i) => {
    el.classList.toggle('active', i === _activeIdx);
    el.setAttribute('aria-pressed', String(i === _activeIdx));
  });
  /* Update dot indicators */
  document.querySelectorAll('.pd-dot').forEach((el, i) => {
    el.classList.toggle('active', i === _activeIdx);
  });
}

/* ── Navigate prev/next ────────────────────────────────────── */
function _prevImage() { _setActiveImage(_activeIdx - 1); }
function _nextImage() { _setActiveImage(_activeIdx + 1); }

/* ── Auto-slide ─────────────────────────────────────────────── */
let _autoSlideTimer = null;

function _startAutoSlide(intervalMs) {
  _stopAutoSlide();
  if (_imgs.length <= 1) return;
  _autoSlideTimer = setInterval(() => _nextImage(), intervalMs || 3000);
}

function _stopAutoSlide() {
  if (_autoSlideTimer) { clearInterval(_autoSlideTimer); _autoSlideTimer = null; }
}

/* Pause auto-slide on user interaction, resume 6s later */
function _pauseAutoSlide() {
  _stopAutoSlide();
  setTimeout(() => _startAutoSlide(3000), 6000);
}

/* ── Render thumbnails ─────────────────────────────────────── */
function _renderThumbs() {
  const wrap = document.getElementById('pdThumbs');
  if (!wrap) return;
  if (_imgs.length <= 1) { wrap.style.display = 'none'; return; }

  wrap.style.display = '';
  /* pointer-events:none on inner <img> so clicks always hit the <button> */
  wrap.innerHTML = _imgs.map((src, i) =>
    `<button class="pd-thumb${i === 0 ? ' active' : ''}"
      onclick="_setActiveImage(${i})"
      aria-label="View image ${i + 1}"
      aria-pressed="${i === 0 ? 'true' : 'false'}">
      <img src="${_esc(src)}" alt="Product view ${i + 1}" loading="lazy"
        style="pointer-events:none"
        onerror="this.closest('.pd-thumb').style.display='none'">
    </button>`
  ).join('');

  /* Also attach event listeners directly so onclick strings are a backup */
  wrap.querySelectorAll('.pd-thumb').forEach((btn, i) => {
    btn.addEventListener('click', () => _setActiveImage(i));
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      _setActiveImage(i);
    }, { passive: false });
  });
}

/* ── Swipe / touch gesture for gallery ────────────────────── */
function _initGallerySwipe() {
  const wrap = document.getElementById('pdMainImgWrap');
  if (!wrap) return;

  /* Make the <img> pass pointer-events through to the wrap */
  const img = document.getElementById('pdMainImg');
  if (img) img.style.pointerEvents = 'none';

  /* Touch swipe */
  wrap.addEventListener('touchstart', e => {
    _touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  wrap.addEventListener('touchend', e => {
    _touchEndX = e.changedTouches[0].screenX;
    const diff = _touchStartX - _touchEndX;
    if (Math.abs(diff) > 40) {
      _pauseAutoSlide();
      diff > 0 ? _nextImage() : _prevImage();
    }
  }, { passive: true });

  /* Keyboard navigation */
  wrap.setAttribute('tabindex', '0');
  wrap.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { _pauseAutoSlide(); _prevImage(); }
    if (e.key === 'ArrowRight') { _pauseAutoSlide(); _nextImage(); }
  });

  /* Arrow buttons — only shown when multiple images */
  if (_imgs.length > 1) {
    const arrowHTML = `
      <button class="pd-gallery-arrow pd-gallery-prev" onclick="_pauseAutoSlide();_prevImage()" aria-label="Previous image">&#8249;</button>
      <button class="pd-gallery-arrow pd-gallery-next" onclick="_pauseAutoSlide();_nextImage()" aria-label="Next image">&#8250;</button>`;
    wrap.insertAdjacentHTML('beforeend', arrowHTML);
  }

  /* Dot indicators below main image */
  if (_imgs.length > 1) {
    const dotsWrap = document.getElementById('pdDots');
    if (dotsWrap) {
      dotsWrap.style.display = 'flex';
      dotsWrap.innerHTML = _imgs.map((_, i) =>
        `<button class="pd-dot${i === 0 ? ' active' : ''}" onclick="_pauseAutoSlide();_setActiveImage(${i})"
          aria-label="Image ${i+1}"></button>`
      ).join('');
    }
  }

  /* Start auto-slide */
  _startAutoSlide(3000);
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

/* ══════════════════════════════════════════════════════════════
   VARIANT SYSTEM
   ══════════════════════════════════════════════════════════════ */

/* Currently selected variant (null = base product) */
let _selectedVariant = null;
let _baseProduct     = null;

/* Called when user taps a variant chip */
function _selectVariant(variantId) {
  const chips = document.querySelectorAll('.pd-variant-chip');

  if (variantId === null) {
    /* Base / "original" selected */
    _selectedVariant = null;
    chips.forEach(c => c.classList.toggle('active', c.dataset.vid === 'base'));
    _updateVariantPriceDisplay(_baseProduct.price, _baseProduct.mrp, _baseProduct.stock);
    return;
  }

  /* Find variant from stored list */
  const vList = window._pdVariants || [];
  const v = vList.find(x => x.id === variantId);
  if (!v) return;

  _selectedVariant = v;
  chips.forEach(c => c.classList.toggle('active', parseInt(c.dataset.vid, 10) === variantId));
  _updateVariantPriceDisplay(v.price, v.mrp, v.stock);
}

/* Update the price row and stock bar without re-rendering everything */
function _updateVariantPriceDisplay(price, mrp, stock) {
  const priceRow  = document.getElementById('pdPriceRow');
  const stockBar  = document.getElementById('pdStockBar');
  const atcBtn    = document.getElementById('pdAddToCartBtn');
  const oosBtn    = document.getElementById('pdOosBtn');

  if (priceRow) {
    const disc = _disc(price, mrp);
    let html = `<span class="pd-price">₹${parseFloat(price).toFixed(2)}</span>`;
    if (mrp && mrp > price) {
      html += `<span class="pd-mrp">₹${parseFloat(mrp).toFixed(2)}</span>
               <span class="pd-save-badge">${disc}% off</span>`;
    }
    priceRow.innerHTML = html;
  }

  if (stock === 0) {
    if (stockBar) { stockBar.className = 'pd-stock-bar pd-stock-bar--oos'; stockBar.textContent = '❌ Out of Stock'; }
    if (atcBtn)   atcBtn.style.display  = 'none';
    if (oosBtn)   oosBtn.style.display  = '';
  } else {
    if (stockBar) { stockBar.className = 'pd-stock-bar pd-stock-bar--in'; stockBar.textContent = '✅ In Stock'; }
    if (atcBtn)   atcBtn.style.display  = '';
    if (oosBtn)   oosBtn.style.display  = 'none';
  }
}

/* Render the variant chips section */
function _renderVariants(variants, baseProduct) {
  const wrap = document.getElementById('pdVariantsWrap');
  if (!wrap) return;
  if (!variants || !variants.length) { wrap.style.display = 'none'; return; }

  window._pdVariants = variants;

  /* "Base" chip label — use product unit or "Original" */
  const baseLabel = baseProduct.unit
    ? `Original (${baseProduct.unit})`
    : 'Original';

  const chipsHTML = [
    /* Base product chip */
    `<button class="pd-variant-chip active" data-vid="base"
        onclick="_selectVariant(null)" type="button">
        <span class="pd-vc-name">${_esc(baseLabel)}</span>
        <span class="pd-vc-price">₹${parseFloat(baseProduct.price).toFixed(2)}</span>
      </button>`
  ].concat(variants.map(v => {
    const label = v.variant_name ||
      (v.size_value ? `${v.size_value} ${v.size_unit}` : v.size_unit);
    const oos   = v.stock === 0;
    return `<button class="pd-variant-chip${oos ? ' pd-vc-oos' : ''}" data-vid="${v.id}"
        onclick="_selectVariant(${v.id})" type="button"
        ${oos ? 'aria-label="' + _esc(label) + ' — out of stock"' : ''}>
        <span class="pd-vc-name">${_esc(label)}</span>
        <span class="pd-vc-price">₹${parseFloat(v.price).toFixed(2)}</span>
        ${oos ? '<span class="pd-vc-oos-tag">Out of stock</span>' : ''}
      </button>`;
  })).join('');

  wrap.innerHTML = `
    <div class="pd-variants-section">
      <h3 class="pd-section-title">Choose Size / Pack</h3>
      <div class="pd-variant-chips" role="group" aria-label="Size options">
        ${chipsHTML}
      </div>
    </div>`;
  wrap.style.display = '';
}

/* ── Add to cart — respects selected variant ───────────────── */
function _pdAddToCart(baseProduct) {
  const v = _selectedVariant;

  let cartItem;
  if (v) {
    /* Variant selected — give it a unique cart key via id encoding */
    cartItem = {
      id:       baseProduct.id * 10000 + v.id,   // unique key per variant
      name:     baseProduct.name + ' — ' + (v.variant_name || v.size_value + ' ' + v.size_unit),
      price:    parseFloat(v.price),
      mrp:      v.mrp ? parseFloat(v.mrp) : null,
      image:    baseProduct.image || '',
      category: baseProduct.category,
      unit:     v.size_value ? (v.size_value + ' ' + v.size_unit) : v.size_unit,
      stock:    v.stock,
    };
  } else {
    if (!baseProduct || baseProduct.stock === 0) return;
    cartItem = Object.assign({}, baseProduct);
  }

  if (cartItem.stock === 0) return;

  const cart  = getCart();
  const found = cart.find(i => i.id === cartItem.id);
  if (found) found.quantity += _pdQty;
  else cart.push(Object.assign({}, cartItem, { quantity: _pdQty }));
  saveCart(cart);
  updateCartBadge();

  const btn = document.getElementById('pdAddToCartBtn');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '✅ Added!';
    btn.disabled  = true;
    setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1800);
  }

  showToast(`${cartItem.name} × ${_pdQty} added to cart ✓`, 'success');
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

  _baseProduct = p;
  _selectedVariant = null;
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

  // Main image HTML — set display:block explicitly so toggle works
  const mainImgHTML = _imgs.length
    ? `<img id="pdMainImg" src="${_esc(_imgs[0])}" alt="${_esc(p.name)}"
        style="display:block;transition:opacity .2s ease"
        onerror="this.style.display='none';document.getElementById('pdMainEmoji').style.display='flex'">`
    : '';

  const emojiDisplay = _imgs.length ? 'none' : 'flex';

  const discBadge = disc > 0
    ? `<span class="pd-discount-badge">-${disc}%</span>`
    : '';

  // Price row — given an id so _updateVariantPriceDisplay can patch it
  let priceHTML = `<span class="pd-price">₹${parseFloat(p.price).toFixed(2)}</span>`;
  if (p.mrp && p.mrp > p.price) {
    priceHTML += `<span class="pd-mrp">₹${parseFloat(p.mrp).toFixed(2)}</span>
                  <span class="pd-save-badge">${disc}% off</span>`;
  }

  // Stock bar — given an id so _updateVariantPriceDisplay can patch it
  const stockBarHTML = oos
    ? `<div class="pd-stock-bar pd-stock-bar--oos" id="pdStockBar">❌ Out of Stock</div>`
    : `<div class="pd-stock-bar pd-stock-bar--in"  id="pdStockBar">✅ In Stock</div>`;

  const descSection = p.description
    ? `<div class="pd-desc-section">
         <h3 class="pd-section-title">About this product</h3>
         <p class="pd-desc">${_esc(p.description)}</p>
       </div>`
    : '';

  const bundlePillHTML = (p.is_bundle && p.display_name)
    ? `<div class="pd-bundle-pill-wrap">
         <span class="pd-bundle-pill">${_esc(p.display_name)}</span>
       </div>`
    : '';

  // Cart / CTA section — ATC and OOS btns both rendered, one hidden
  const alreadyMsg = cartQty > 0
    ? `<p class="pd-already-in-cart">Already in cart: <strong>${cartQty}</strong></p>`
    : '';

  const cartSection = `
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
          style="${oos ? 'display:none' : ''}"
          onclick="_pdAddToCart(${pSafe})">🛒 Add to Cart</button>
        <button class="btn btn-ghost btn-lg pd-oos-btn" id="pdOosBtn"
          style="${oos ? '' : 'display:none'}" disabled>
          ❌ Out of Stock</button>
      </div>
    </div>
    ${alreadyMsg}`;

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
      <!-- Dot indicators for auto-slide (shown only when >1 image) -->
      <div id="pdDots" class="pd-dots" style="display:none" role="tablist" aria-label="Image indicators"></div>
    </div>

    <!-- Info column -->
    <div class="pd-info-col">

      <div class="pd-category">
        ${emoji} ${_esc(p.category)}
        ${p.category === 'New Launches' ? '<span class="pd-new-badge">New Launch</span>' : ''}
      </div>

      <h1 class="pd-name">${_esc(p.name)}</h1>

      <div class="pd-price-row" id="pdPriceRow">${priceHTML}</div>

      ${stockBarHTML}

      ${descSection}

      ${bundlePillHTML}

      <!-- Variant chips injected here after API call -->
      <div id="pdVariantsWrap" style="display:none"></div>

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

    /* ── Full-width stock bar ────────────────────────────── */
    .pd-stock-bar {
      display: flex; align-items: center; width: 100%;
      padding: 8px 14px; border-radius: var(--r-sm);
      font-size: .8rem; font-weight: 700; margin-bottom: 18px;
      letter-spacing: .01em;
    }
    .pd-stock-bar--in {
      background: var(--success-pale); color: var(--success);
      border: 1px solid rgba(30,125,58,.15);
    }
    .pd-stock-bar--oos {
      background: var(--error-pale); color: var(--error);
      border: 1px solid rgba(192,57,43,.15);
    }

    /* ── ATC button ──────────────────────────────────────── */
    .pd-atc-btn {
      background: var(--ink); color: #fff; border: none;
      border-radius: var(--r-full); padding: 0 22px;
      min-height: 52px; font-size: .92rem; font-weight: 700;
      letter-spacing: .01em; white-space: nowrap; cursor: pointer;
      transition: background .15s, transform .1s;
      touch-action: manipulation; -webkit-tap-highlight-color: transparent;
    }
    .pd-atc-btn:hover  { background: var(--ink-mid); }
    .pd-atc-btn:active { transform: scale(.97); }
    .pd-atc-btn:disabled { background: var(--border-dark); cursor: not-allowed; transform: none; }

    /* ── Bundle pill ─────────────────────────────────────── */
    .pd-bundle-pill-wrap { margin-bottom: 20px; }
    .pd-bundle-pill {
      display: inline-block; padding: 9px 24px; border-radius: 8px;
      font-size: .88rem; font-weight: 700; letter-spacing: .03em;
      color: #fff; background: var(--ink); border: 2px solid var(--ink);
    }

    /* ── Section title ───────────────────────────────────── */
    .pd-section-title {
      font-size: .65rem; font-weight: 800; text-transform: uppercase;
      letter-spacing: .1em; color: var(--ink-soft);
      margin-bottom: 10px; padding-bottom: 6px;
      border-bottom: 1.5px solid var(--border);
    }

    /* ══ VARIANT CHIPS ════════════════════════════════════ */
    .pd-variants-section { margin-bottom: 22px; }

    .pd-variant-chips {
      display: flex; flex-wrap: wrap; gap: 8px;
      margin-top: 10px;
    }

    .pd-variant-chip {
      display: flex; flex-direction: column; align-items: center;
      gap: 3px; padding: 8px 14px; border-radius: 10px;
      border: 1.5px solid var(--border);
      background: var(--surface); cursor: pointer;
      transition: border-color .15s, background .15s, transform .1s;
      touch-action: manipulation; -webkit-tap-highlight-color: transparent;
      min-width: 72px; text-align: center;
    }
    .pd-variant-chip:hover {
      border-color: var(--brand); background: var(--brand-ultra);
    }
    .pd-variant-chip.active {
      border-color: var(--ink); background: var(--ink); color: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,.18);
    }
    .pd-variant-chip.active .pd-vc-price {
      color: rgba(255,255,255,.8);
    }
    .pd-variant-chip.pd-vc-oos {
      opacity: .48; cursor: not-allowed;
    }
    .pd-vc-name {
      font-size: .78rem; font-weight: 700; line-height: 1.2;
      letter-spacing: .01em;
    }
    .pd-vc-price {
      font-size: .72rem; color: var(--brand); font-weight: 600;
    }
    .pd-vc-oos-tag {
      font-size: .62rem; color: var(--error); font-weight: 600;
      margin-top: 2px;
    }

    @media (max-width: 360px) {
      .pd-variant-chip { padding: 7px 10px; min-width: 60px; }
      .pd-vc-name { font-size: .72rem; }
    }

    /* ══ DOT INDICATORS ══════════════════════════════════ */
    .pd-dots {
      justify-content: center;
      gap: 6px;
      margin-top: 8px;
      padding: 2px 0;
    }
    .pd-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--border-dark); border: none; padding: 0;
      cursor: pointer; transition: background .2s, transform .2s;
      touch-action: manipulation; -webkit-tap-highlight-color: transparent;
      flex-shrink: 0;
    }
    .pd-dot.active {
      background: var(--brand);
      transform: scale(1.35);
    }
    .pd-dot:not(.active):hover { background: var(--brand-light); }
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

    const res = await _fetcher(`${_productAPI}/products/${encodeURIComponent(id)}`, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeout);

    if (!res.ok) throw new Error('HTTP ' + res.status);

    const json = await res.json();
    if (!json.success || !json.data) throw new Error(json.message || 'Product not found');

    const product = json.data;

    /* Render product first so DOM exists */
    _renderProduct(product);

    /* Use variants already embedded in the product response (p.variants).
       Fall back to a separate fetch only if the embedded array is missing. */
    const embeddedVariants = Array.isArray(product.variants) ? product.variants.filter(v => v.is_active !== 0) : null;

    if (embeddedVariants && embeddedVariants.length) {
      _renderVariants(embeddedVariants, product);
    } else {
      /* Fallback: separate /variants request */
      try {
        const varRes  = await _fetcher(`${_productAPI}/products/${encodeURIComponent(id)}/variants`, {
          headers: { 'Accept': 'application/json' }
        });
        if (varRes.ok) {
          const varJson = await varRes.json();
          if (varJson.success && Array.isArray(varJson.data) && varJson.data.length) {
            _renderVariants(varJson.data, product);
          }
        }
      } catch (e) { /* variants are optional */ }
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      _showError('Request timed out. Please check your connection and try again.');
    } else {
      _showError('Could not load product details. Please try again.');
    }
    console.error('[product.js]', err);
  }
}());
