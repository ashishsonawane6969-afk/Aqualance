/* ═══════════════════════════════════════════════════════════════
   app.js — Aqualence Ventures · iKrish Wellness
   FIXED: data fetch reliability, scroll bugs, retry logic, dedup
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// 🔥 FORCE all fetch calls to use Railway backend
const ORIGINAL_FETCH = window.fetch;

window.fetch = function (url, options = {}) {
  if (typeof url === 'string' && url.startsWith('/api')) {
    url = 'https://aqualance-production-9e22.up.railway.app' + url;
  }
  return ORIGINAL_FETCH(url, options);
};



const API = 'https://aqualance-production-9e22.up.railway.app/api/v1';

/* ─────────────────────────────────────────────────────────────
   TOAST
───────────────────────────────────────────────────────────── */
function showToast(msg, type, duration) {
  type     = type     || 'default';
  duration = duration || 3000;
  var c = document.getElementById('toastContainer');
  if (!c) return;
  var t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(function() { t.remove(); }, duration);
}

/* ─────────────────────────────────────────────────────────────
   CART  (localStorage-backed, shared across pages)
───────────────────────────────────────────────────────────── */
function getCart() {
  try { return JSON.parse(localStorage.getItem('aq_cart') || '[]'); }
  catch (e) { return []; }
}
function saveCart(cart) {
  localStorage.setItem('aq_cart', JSON.stringify(cart));
  updateCartBadge();
}
function cartTotal() {
  return getCart().reduce(function(s, i) { return s + i.price * i.quantity; }, 0);
}
function removeFromCart(productId) {
  saveCart(getCart().filter(function(i) { return i.id !== productId; }));
}
function updateCartBadge() {
  var count = getCart().reduce(function(s, i) { return s + i.quantity; }, 0);
  document.querySelectorAll('#cartCount').forEach(function(el) {
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

function addToCart(product) {
  var cart  = getCart();
  var found = cart.find(function(i) { return i.id === product.id; });
  if (found) found.quantity += 1;
  else cart.push(Object.assign({}, product, { quantity: 1 }));
  saveCart(cart);
  showToast(product.name + ' added to cart ✓', 'success');
  renderProductCards();
}
function incrementCart(id, product) {
  var cart = getCart();
  var item = cart.find(function(i) { return i.id === id; });
  if (item) { item.quantity++; saveCart(cart); renderProductCards(); }
  else addToCart(product);
}
function decrementCart(id) {
  var cart = getCart();
  var idx  = cart.findIndex(function(i) { return i.id === id; });
  if (idx === -1) return;
  if (cart[idx].quantity <= 1) cart.splice(idx, 1);
  else cart[idx].quantity--;
  saveCart(cart);
  renderProductCards();
}

/* ─────────────────────────────────────────────────────────────
   PRODUCT LISTING STATE
───────────────────────────────────────────────────────────── */
var catEmoji = {
  'Face Care': '💆', 'Hair Care': '💇', 'Body Care': '🧴',
  'Essentials': '🧼', 'New Launches': '✨', 'General': '📦'
};

var allProducts    = [];
var activeCategory = 'All';
var searchQuery    = '';
var sortMode       = 'default';
var _loadPending   = false;
var _fetchAbortCtrl = null; // track in-flight request

var PAGE_SIZE  = 12;
var _pageShown = PAGE_SIZE;

/* ─────────────────────────────────────────────────────────────
   FILTERING & SORTING
───────────────────────────────────────────────────────────── */
function getFilteredProducts() {
  var list = allProducts;

  if (activeCategory !== 'All') {
    list = list.filter(function(p) { return p.category === activeCategory; });
  }

  var q = searchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(function(p) {
      return p.name.toLowerCase().indexOf(q) !== -1 ||
             (p.category    || '').toLowerCase().indexOf(q) !== -1 ||
             (p.description || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  // Sort — always copy array first so allProducts stays untouched
  if (sortMode === 'price-asc') {
    list = list.slice().sort(function(a, b) { return a.price - b.price; });
  } else if (sortMode === 'price-desc') {
    list = list.slice().sort(function(a, b) { return b.price - a.price; });
  } else if (sortMode === 'name-asc') {
    list = list.slice().sort(function(a, b) { return a.name.localeCompare(b.name); });
  } else if (sortMode === 'discount') {
    list = list.slice().sort(function(a, b) {
      var da = a.mrp ? ((a.mrp - a.price) / a.mrp) : 0;
      var db = b.mrp ? ((b.mrp - b.price) / b.mrp) : 0;
      return db - da;
    });
  }

  return list;
}

/* ─────────────────────────────────────────────────────────────
   PRODUCT CARD HTML
───────────────────────────────────────────────────────────── */
function discount(price, mrp) {
  if (!mrp || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

function _productCardHTML(p) {
  var cart   = getCart();
  var inCart = cart.find(function(c) { return c.id === p.id; });
  var qty    = inCart ? inCart.quantity : 0;
  var disc   = discount(p.price, p.mrp);
  var emoji  = catEmoji[p.category] || '📦';
  var isNew  = p.category === 'New Launches';

  // Safe JSON for inline onclick — prevents HTML injection
  var pJSON = JSON.stringify(p)
    .replace(/"/g, '&quot;').replace(/</g, '&#60;').replace(/>/g, '&#62;');

  // Image with lazy loading
  var imgHTML = p.image && p.image.trim()
    ? '<img src="' + p.image + '" alt="' + p.name.replace(/"/g, '&quot;') + '" loading="lazy" onerror="this.style.display=\'none\'">'
    : '<span class="product-img-emoji">' + emoji + '</span>';

  var mrpHTML = (p.mrp && p.mrp > p.price)
    ? '<div class="product-mrp">MRP ₹' + parseFloat(p.mrp).toFixed(0) + '</div>'
    : '';

  var descHTML = p.description
    ? '<div class="product-desc">' + (p.description.length > 80 ? p.description.slice(0, 80) + '…' : p.description) + '</div>'
    : '';

  // Bundle info line
  var bundleHTML = '';
  if (p.is_bundle && p.display_name) {
    bundleHTML = '<div class="product-bundle-line">'
      + '<span class="product-bundle-tag">📦 Bundle</span>'
      + '<span class="product-bundle-name">' + p.display_name.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</span>'
      + '</div>';
  }

  // Cart control
  var cartHTML;
  if (p.stock === 0) {
    cartHTML = '<button class="add-btn oos-btn" disabled aria-label="Out of stock">OOS</button>';
  } else if (qty === 0) {
    cartHTML = '<button class="add-btn" onclick="addToCart(' + pJSON + ')" aria-label="Add to cart">+</button>';
  } else {
    cartHTML = '<div class="qty-row">'
      + '<button class="qty-btn" onclick="decrementCart(' + p.id + ')" aria-label="Remove one">−</button>'
      + '<span class="qty-val" aria-live="polite">' + qty + '</span>'
      + '<button class="qty-btn" onclick="incrementCart(' + p.id + ',' + pJSON + ')" aria-label="Add one">+</button>'
      + '</div>';
  }

  // Badges
  var badges = '';
  if (isNew)       badges += '<span class="product-badge-new">New</span>';
  else if (disc > 0) badges += '<span class="product-badge-new" style="background:var(--success)">-' + disc + '%</span>';
  badges += '<span class="product-card-tap-hint">Tap for details</span>';

  return '<div class="product-card" data-id="' + p.id + '" role="article"'
    + ' onclick="handleProductCardClick(event,' + p.id + ')"'
    + ' tabindex="0"'
    + ' aria-label="' + p.name.replace(/"/g, '&quot;') + ', ₹' + parseFloat(p.price).toFixed(0) + '">'
    + '<div class="product-img">' + imgHTML + badges + '</div>'
    + '<div class="product-info">'
    +   '<div class="product-category">' + p.category + '</div>'
    +   '<div class="product-name">' + p.name + '</div>'
    +   bundleHTML
    +   descHTML
    +   '<div class="product-price-row">'
    +     '<div><div class="product-price">₹' + parseFloat(p.price).toFixed(0) + '</div>' + mrpHTML + '</div>'
    +     '<div onclick="event.stopPropagation()">' + cartHTML + '</div>'
    +   '</div>'
    + '</div>'
    + '</div>';
}

/* ─────────────────────────────────────────────────────────────
   RENDER PRODUCT CARDS
───────────────────────────────────────────────────────────── */
function renderProductCards() {
  var grid = document.getElementById('productsGrid');
  if (!grid) return;

  var filtered = getFilteredProducts();
  var visible  = filtered.slice(0, _pageShown);

  // Count badge
  var countEl = document.getElementById('productsCount');
  if (countEl) {
    countEl.textContent = filtered.length
      ? filtered.length + ' product' + (filtered.length !== 1 ? 's' : '')
      : '';
  }

  // Load-more button
  var loadWrap = document.getElementById('loadMoreWrap');
  if (loadWrap) {
    loadWrap.style.display = filtered.length > _pageShown ? '' : 'none';
  }

  // Empty state
  if (!filtered.length) {
    var emptyMsg = searchQuery
      ? 'No products match &ldquo;' + searchQuery + '&rdquo;. Try a different search.'
      : 'Check back soon for new products.';
    var clearBtn = searchQuery
      ? '<button class="btn btn-outline btn-sm" style="margin-top:12px" onclick="clearSearch()">Clear Search</button>'
      : '';
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">'
      + '<div class="icon">' + (searchQuery ? '🔍' : '📦') + '</div>'
      + '<h3>' + (searchQuery ? 'No results found' : 'No products available') + '</h3>'
      + '<p>' + emptyMsg + '</p>'
      + clearBtn
      + '</div>';
    return;
  }

  // Build all HTML at once → single innerHTML write (fastest on mobile)
  grid.innerHTML = visible.map(_productCardHTML).join('');
}

/* ─────────────────────────────────────────────────────────────
   PRODUCT CARD CLICK → product.html?id=X
───────────────────────────────────────────────────────────── */
function handleProductCardClick(event, productId) {
  if (event.target.closest && event.target.closest('.qty-row, .add-btn, .oos-btn, .qty-btn')) return;
  window.location.href = '/product.html?id=' + productId;
}

document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var card = e.target.closest && e.target.closest('.product-card');
  if (!card) return;
  var id = card.dataset.id;
  if (id) { e.preventDefault(); window.location.href = '/product.html?id=' + id; }
});

/* ─────────────────────────────────────────────────────────────
   PAGINATION — Load More
───────────────────────────────────────────────────────────── */
function loadMoreProducts() {
  var prevShown = _pageShown;
  _pageShown += PAGE_SIZE;
  renderProductCards();

  // Scroll to first new card after render
  requestAnimationFrame(function() {
    var grid  = document.getElementById('productsGrid');
    if (!grid) return;
    var cards = grid.querySelectorAll('.product-card');
    if (cards[prevShown]) {
      cards[prevShown].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   CATEGORY PILLS
───────────────────────────────────────────────────────────── */
function initCategoryPills() {
  document.querySelectorAll('.cat-pill').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.cat-pill').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      activeCategory = btn.dataset.cat;
      _pageShown = PAGE_SIZE;
      renderProductCards();
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   SORT SELECT
───────────────────────────────────────────────────────────── */
function initSort() {
  var sel = document.getElementById('sortSelect');
  if (!sel) return;
  sel.addEventListener('change', function() {
    sortMode   = sel.value;
    _pageShown = PAGE_SIZE;
    renderProductCards();
  });
}

/* ─────────────────────────────────────────────────────────────
   SEARCH  (debounced 250ms, synced desktop ↔ mobile)
───────────────────────────────────────────────────────────── */
var _searchDebounce = null;

function _handleSearchInput(value, sourceId) {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(function() {
    searchQuery = value;
    _pageShown  = PAGE_SIZE;

    // Sync the OTHER search field (not the one the user is typing in)
    var otherIds = ['productSearch', 'productSearchDesktop'].filter(function(id) { return id !== sourceId; });
    otherIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (el && el.value !== value) el.value = value;
    });

    // Show/hide clear buttons
    document.querySelectorAll('.search-clear-btn').forEach(function(btn) {
      btn.style.display = value ? '' : 'none';
    });

    renderProductCards();
  }, 250);
}

function initSearch() {
  ['productSearch', 'productSearchDesktop'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function(e) { _handleSearchInput(e.target.value, id); });
  });

  var clearMobile  = document.getElementById('searchClearBtn');
  var clearDesktop = document.getElementById('searchClearBtnDesktop');
  if (clearMobile)  clearMobile.addEventListener('click',  clearSearch);
  if (clearDesktop) clearDesktop.addEventListener('click', clearSearch);
}

function clearSearch() {
  ['productSearch', 'productSearchDesktop'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.search-clear-btn').forEach(function(btn) { btn.style.display = 'none'; });
  searchQuery = '';
  _pageShown  = PAGE_SIZE;
  renderProductCards();
}

/* ─────────────────────────────────────────────────────────────
   SKELETON LOADER
───────────────────────────────────────────────────────────── */
function showProductSkeletons(count) {
  count = count || 8;
  var grid = document.getElementById('productsGrid');
  if (!grid) return;
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="product-card-skeleton skeleton" aria-hidden="true"></div>';
  }
  grid.innerHTML = html;
}

/* ─────────────────────────────────────────────────────────────
   LOAD PRODUCTS
   FIX 1: Accepts both { success, data } and legacy { data } shapes
   FIX 2: Abort any in-flight request before starting a new one
   FIX 3: _loadPending always cleared in finally — no stuck state
   FIX 4: Retry button resets state fully before re-fetching
───────────────────────────────────────────────────────────── */
function _showLoadError() {
  var grid = document.getElementById('productsGrid');
  if (!grid) return;
  grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1">'
    + '<div class="icon">⚠️</div>'
    + '<h3>Could not load products</h3>'
    + '<p>Check your connection and try again.</p>'
    + '<button class="btn btn-outline btn-sm" style="margin-top:12px" onclick="retryLoadProducts()">↻ Retry</button>'
    + '</div>';
}

function retryLoadProducts() {
  // Full reset before retrying
  _loadPending = false;
  if (_fetchAbortCtrl) { try { _fetchAbortCtrl.abort(); } catch(e) {} }
  _fetchAbortCtrl = null;
  loadProducts();
}

async function loadProducts() {
  var grid = document.getElementById('productsGrid');
  if (!grid) return;

  // Prevent duplicate concurrent fetches
  if (_loadPending) return;
  _loadPending = true;

  // Cancel any previous in-flight request
  if (_fetchAbortCtrl) {
    try { _fetchAbortCtrl.abort(); } catch(e) {}
  }
  _fetchAbortCtrl = new AbortController();

  showProductSkeletons(8);

  // Adaptive timeout: uses AqNet (network.js) if loaded, else 20s fallback
  var _adaptiveTimeout = (window.AqNet && window.AqNet.quality) ? window.AqNet.quality.timeout() : 20000;
  var timeoutId = setTimeout(function() {
    try { _fetchAbortCtrl.abort(); } catch(e) {}
  }, _adaptiveTimeout);

  try {
    var _fetcher = (window.AqNet && window.AqNet.fetch) ? window.AqNet.fetch : fetch;
    var res = await _fetcher(API + '/products', {
      signal:  _fetchAbortCtrl.signal,
      headers: { 'Accept': 'application/json' },
      cache:   'no-store'
    });

    clearTimeout(timeoutId);

    if (!res.ok) throw new Error('Server returned HTTP ' + res.status);

    var json = await res.json();

    // FIX: accept { success, data } OR legacy { data } response shape
    var rows = null;
    if (Array.isArray(json))           rows = json;           // raw array
    else if (Array.isArray(json.data)) rows = json.data;      // { data: [] }
    else throw new Error(json.message || 'Unexpected response format');

    allProducts = rows;
    renderProductCards();

  } catch (err) {
    clearTimeout(timeoutId);

    if (err.name === 'AbortError') {
      // Aborted by timeout or retryLoadProducts — show error
      console.warn('[app.js] loadProducts: request aborted');
    } else {
      console.error('[app.js] loadProducts:', err.message);
    }
    _showLoadError();

  } finally {
    _loadPending    = false;
    _fetchAbortCtrl = null;
  }
}

/* ─────────────────────────────────────────────────────────────
   BACK TO TOP
───────────────────────────────────────────────────────────── */
function initBackToTop() {
  var btn = document.getElementById('backToTop');
  if (!btn) return;

  btn.onclick = function() { window.scrollTo({ top: 0, behavior: 'smooth' }); };

  var ticking = false;
  window.addEventListener('scroll', function() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function() {
      btn.style.display = (window.scrollY > 400) ? 'flex' : 'none';
      ticking = false;
    });
  }, { passive: true });
}

/* ─────────────────────────────────────────────────────────────
   SMOOTH SCROLL for #anchor links
───────────────────────────────────────────────────────────── */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(function(a) {
    a.addEventListener('click', function(e) {
      var href   = a.getAttribute('href');
      var target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────────── */
updateCartBadge();
initCategoryPills();
initSearch();
initSort();
initBackToTop();
initSmoothScroll();

if (document.getElementById('productsGrid')) {
  loadProducts();
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
    // Fallback: inject floating button if no button in HTML
    var btn = document.createElement('button');
    btn.id = 'dmToggleBtn';
    btn.className = 'dm-toggle dm-float';
    btn.title = 'Toggle dark mode';
    btn.setAttribute('aria-label', 'Toggle dark mode');
    btn.textContent = isDark() ? '☀️' : '🌙';
    btn.addEventListener('click', function() { applyTheme(!isDark()); });
    document.body.appendChild(btn);
  }
  // Apply saved or system theme immediately
  var saved;
  try { saved = localStorage.getItem(KEY); } catch(e){}
  if (!saved) saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  applyTheme(saved === 'dark');
  // Wire up / inject button after DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBtn);
  } else {
    injectBtn();
  }
})();
