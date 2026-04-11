/* ═══════════════════════════════════════════════════════════════
   product.js  —  Product Detail Page
   Works on first load, works on mobile, no hard-refresh needed.
   Requires app.js (getCart, saveCart, updateCartBadge, showToast).
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── Config ───────────────────────────────────────────────── */
  var API = 'https://aqualance-production.up.railway.app/api/v1';

  /* ── Helpers ──────────────────────────────────────────────── */
  function esc(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s == null ? '' : String(s)));
    return d.innerHTML;
  }
  function disc(price, mrp) {
    if (!mrp || mrp <= price) return 0;
    return Math.round((mrp - price) / mrp * 100);
  }
  var CE = {
    'Face Care':'💆','Hair Care':'💇','Body Care':'🧴',
    'Essentials':'🧼','New Launches':'✨','General':'📦'
  };
  function el(id) { return document.getElementById(id); }

  /* ── State ────────────────────────────────────────────────── */
  var imgs          = [];   // all gallery image URLs
  var activeIdx     = 0;
  var autoTimer     = null;
  var qty           = 1;
  var baseProduct   = null;
  var selVariant    = null;
  var allVariants   = [];
  var touchX0       = 0;

  /* ══════════════════════════════════════════════════════════
     GALLERY
  ══════════════════════════════════════════════════════════ */

  function buildImgs(p) {
    imgs = [];
    if (p.image && p.image.trim()) imgs.push(p.image.trim());

    // Backend already parsed images into an array; guard both cases
    var extras = p.images;
    if (typeof extras === 'string') {
      try { extras = JSON.parse(extras); } catch (e) { extras = []; }
    }
    if (Array.isArray(extras)) {
      extras.forEach(function (u) {
        if (u && u.trim() && imgs.indexOf(u.trim()) === -1) imgs.push(u.trim());
      });
    }
    activeIdx = 0;
  }

  /* Show image at index — simple, no fade race conditions */
  function showImg(idx) {
    if (!imgs.length) return;
    activeIdx = ((idx % imgs.length) + imgs.length) % imgs.length;

    var mainImg = el('pdMainImg');
    var emoji   = el('pdMainEmoji');

    if (mainImg) {
      mainImg.src = imgs[activeIdx];
      mainImg.style.display = 'block';
      mainImg.style.opacity = '1';
    }
    if (emoji) emoji.style.display = 'none';

    // Sync thumb active state
    var thumbs = document.querySelectorAll('.pd-thumb');
    thumbs.forEach(function (btn, i) {
      btn.classList.toggle('active', i === activeIdx);
      btn.setAttribute('aria-pressed', String(i === activeIdx));
    });

    // Sync dot active state
    var dots = document.querySelectorAll('.pd-dot');
    dots.forEach(function (d, i) {
      d.classList.toggle('active', i === activeIdx);
    });
  }

  function prevImg() { stopAuto(); showImg(activeIdx - 1); resumeAuto(); }
  function nextImg() { stopAuto(); showImg(activeIdx + 1); resumeAuto(); }

  /* ── Auto-slide ─────────────────────────────────────────── */
  function startAuto() {
    stopAuto();
    if (imgs.length <= 1) return;
    autoTimer = setInterval(function () { showImg(activeIdx + 1); }, 3000);
  }
  function stopAuto() {
    if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  }
  var resumeHandle = null;
  function resumeAuto() {
    if (resumeHandle) clearTimeout(resumeHandle);
    resumeHandle = setTimeout(startAuto, 5000);
  }

  /* ── Render thumbnails + dots + attach ALL events via JS ── */
  function renderGallery() {
    var thumbWrap = el('pdThumbs');
    var dotWrap   = el('pdDots');
    var mainWrap  = el('pdMainImgWrap');

    if (!thumbWrap) return;

    if (imgs.length <= 1) {
      thumbWrap.style.display = 'none';
      if (dotWrap) dotWrap.style.display = 'none';
      return;
    }

    /* Thumbnails */
    thumbWrap.style.display = 'flex';
    thumbWrap.innerHTML = imgs.map(function (src, i) {
      return '<button class="pd-thumb' + (i === 0 ? ' active' : '') + '"'
           + ' type="button" aria-label="View image ' + (i+1) + '"'
           + ' aria-pressed="' + (i === 0) + '">'
           + '<img src="' + esc(src) + '" alt="Product view ' + (i+1) + '"'
           + ' style="pointer-events:none;width:100%;height:100%;object-fit:cover;display:block"'
           + ' onerror="this.closest(\'.pd-thumb\').style.display=\'none\'">'
           + '</button>';
    }).join('');

    // Attach click + touchend directly to every thumb button
    thumbWrap.querySelectorAll('.pd-thumb').forEach(function (btn, i) {
      btn.addEventListener('click', function () { stopAuto(); showImg(i); resumeAuto(); });
      btn.addEventListener('touchend', function (e) {
        e.preventDefault(); // prevent ghost click
        stopAuto(); showImg(i); resumeAuto();
      }, { passive: false });
    });

    /* Dot indicators */
    if (dotWrap) {
      dotWrap.style.display = 'flex';
      dotWrap.innerHTML = imgs.map(function (_, i) {
        return '<button class="pd-dot' + (i === 0 ? ' active' : '') + '"'
             + ' type="button" aria-label="Image ' + (i+1) + '"></button>';
      }).join('');

      dotWrap.querySelectorAll('.pd-dot').forEach(function (d, i) {
        d.addEventListener('click', function () { stopAuto(); showImg(i); resumeAuto(); });
        d.addEventListener('touchend', function (e) {
          e.preventDefault();
          stopAuto(); showImg(i); resumeAuto();
        }, { passive: false });
      });
    }

    /* Arrow buttons */
    var prevBtn = document.createElement('button');
    prevBtn.className   = 'pd-gallery-arrow pd-gallery-prev';
    prevBtn.type        = 'button';
    prevBtn.setAttribute('aria-label', 'Previous image');
    prevBtn.innerHTML   = '&#8249;';
    prevBtn.addEventListener('click',    prevImg);
    prevBtn.addEventListener('touchend', function (e) { e.preventDefault(); prevImg(); }, { passive: false });

    var nextBtn = document.createElement('button');
    nextBtn.className   = 'pd-gallery-arrow pd-gallery-next';
    nextBtn.type        = 'button';
    nextBtn.setAttribute('aria-label', 'Next image');
    nextBtn.innerHTML   = '&#8250;';
    nextBtn.addEventListener('click',    nextImg);
    nextBtn.addEventListener('touchend', function (e) { e.preventDefault(); nextImg(); }, { passive: false });

    mainWrap.appendChild(prevBtn);
    mainWrap.appendChild(nextBtn);

    /* Swipe on main image wrap */
    if (mainWrap) {
      // Make the img itself not intercept touches
      var mainImg = el('pdMainImg');
      if (mainImg) mainImg.style.pointerEvents = 'none';

      mainWrap.addEventListener('touchstart', function (e) {
        touchX0 = e.changedTouches[0].clientX;
      }, { passive: true });

      mainWrap.addEventListener('touchend', function (e) {
        var dx = touchX0 - e.changedTouches[0].clientX;
        if (Math.abs(dx) > 40) {
          stopAuto();
          if (dx > 0) showImg(activeIdx + 1); else showImg(activeIdx - 1);
          resumeAuto();
        }
      }, { passive: true });

      /* Keyboard */
      mainWrap.setAttribute('tabindex', '0');
      mainWrap.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft')  { stopAuto(); showImg(activeIdx - 1); resumeAuto(); }
        if (e.key === 'ArrowRight') { stopAuto(); showImg(activeIdx + 1); resumeAuto(); }
      });
    }

    startAuto();
  }

  /* ══════════════════════════════════════════════════════════
     VARIANT SELECTOR
  ══════════════════════════════════════════════════════════ */

  function renderVariants(variants) {
    var wrap = el('pdVariantsWrap');
    if (!wrap) return;

    allVariants = (variants || []).filter(function (v) {
      return v.is_active !== 0 && v.is_active !== false;
    });

    if (!allVariants.length) { wrap.style.display = 'none'; return; }

    var baseLabel = baseProduct.unit ? 'Original (' + baseProduct.unit + ')' : 'Original';

    var section = document.createElement('div');
    section.className = 'pd-variants-section';

    var title = document.createElement('h3');
    title.className   = 'pd-section-title';
    title.textContent = 'Choose Size / Pack';
    section.appendChild(title);

    var chips = document.createElement('div');
    chips.className = 'pd-variant-chips';
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Size options');

    /* Base chip */
    var baseChip = makeChip(baseLabel, baseProduct.price, false, 'base');
    baseChip.classList.add('active');
    baseChip.addEventListener('click', function () { selectVariant(null); });
    baseChip.addEventListener('touchend', function (e) {
      e.preventDefault(); selectVariant(null);
    }, { passive: false });
    chips.appendChild(baseChip);

    /* Variant chips */
    allVariants.forEach(function (v) {
      var label = v.variant_name || (v.size_value ? v.size_value + ' ' + v.size_unit : v.size_unit);
      var oos   = (v.stock === 0);
      var chip  = makeChip(label, v.price, oos, v.id);
      if (!oos) {
        chip.addEventListener('click', function () { selectVariant(v.id); });
        chip.addEventListener('touchend', function (e) {
          e.preventDefault(); selectVariant(v.id);
        }, { passive: false });
      }
      chips.appendChild(chip);
    });

    section.appendChild(chips);

    wrap.innerHTML = '';
    wrap.appendChild(section);
    wrap.style.display = '';
  }

  function makeChip(label, price, oos, vid) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pd-variant-chip' + (oos ? ' pd-vc-oos' : '');
    btn.dataset.vid = String(vid);
    if (oos) btn.setAttribute('disabled', '');

    var nm = document.createElement('span');
    nm.className   = 'pd-vc-name';
    nm.textContent = label;

    var pr = document.createElement('span');
    pr.className   = 'pd-vc-price';
    pr.textContent = '₹' + parseFloat(price).toFixed(2);

    btn.appendChild(nm);
    btn.appendChild(pr);

    if (oos) {
      var ot = document.createElement('span');
      ot.className   = 'pd-vc-oos-tag';
      ot.textContent = 'Out of stock';
      btn.appendChild(ot);
    }
    return btn;
  }

  function selectVariant(vid) {
    if (vid === null) {
      selVariant = null;
    } else {
      selVariant = allVariants.find(function (v) { return v.id === vid; }) || null;
    }

    /* Update active chip */
    document.querySelectorAll('.pd-variant-chip').forEach(function (c) {
      if (vid === null) {
        c.classList.toggle('active', c.dataset.vid === 'base');
      } else {
        c.classList.toggle('active', parseInt(c.dataset.vid, 10) === vid);
      }
    });

    /* Update price + stock bar */
    var p = selVariant || baseProduct;
    updatePriceDisplay(p.price, p.mrp, p.stock);
  }

  function updatePriceDisplay(price, mrp, stock) {
    var priceRow = el('pdPriceRow');
    var stockBar = el('pdStockBar');
    var atcBtn   = el('pdAddToCartBtn');
    var oosBtn   = el('pdOosBtn');

    if (priceRow) {
      var d   = disc(price, mrp);
      var html = '<span class="pd-price">₹' + parseFloat(price).toFixed(2) + '</span>';
      if (mrp && mrp > price) {
        html += '<span class="pd-mrp">₹' + parseFloat(mrp).toFixed(2) + '</span>'
              + '<span class="pd-save-badge">' + d + '% off</span>';
      }
      priceRow.innerHTML = html;
    }

    var oos = (stock === 0);
    if (stockBar) {
      stockBar.className   = 'pd-stock-bar pd-stock-bar--' + (oos ? 'oos' : 'in');
      stockBar.textContent = oos ? '❌ Out of Stock' : '✅ In Stock';
    }
    if (atcBtn) atcBtn.style.display = oos ? 'none' : '';
    if (oosBtn) oosBtn.style.display = oos ? ''     : 'none';
  }

  /* ══════════════════════════════════════════════════════════
     CART
  ══════════════════════════════════════════════════════════ */

  function addToCart() {
    var v = selVariant;
    var item;

    if (v) {
      item = {
        id:       baseProduct.id * 10000 + v.id,
        name:     baseProduct.name + ' — ' + (v.variant_name || v.size_value + ' ' + v.size_unit),
        price:    parseFloat(v.price),
        mrp:      v.mrp ? parseFloat(v.mrp) : null,
        image:    baseProduct.image || '',
        category: baseProduct.category,
        unit:     v.size_value ? v.size_value + ' ' + v.size_unit : v.size_unit,
        stock:    v.stock
      };
    } else {
      if (!baseProduct || baseProduct.stock === 0) return;
      item = {
        id: baseProduct.id, name: baseProduct.name,
        price: parseFloat(baseProduct.price),
        mrp: baseProduct.mrp ? parseFloat(baseProduct.mrp) : null,
        image: baseProduct.image || '', category: baseProduct.category,
        unit: baseProduct.unit || '', stock: baseProduct.stock
      };
    }

    if (!item.stock || item.stock === 0) return;

    var cart  = getCart();
    var found = cart.find(function (c) { return c.id === item.id; });
    if (found) { found.quantity += qty; }
    else { cart.push(Object.assign({}, item, { quantity: qty })); }
    saveCart(cart);
    updateCartBadge();

    var btn = el('pdAddToCartBtn');
    if (btn) {
      var orig = btn.textContent;
      btn.textContent = '✅ Added!';
      btn.disabled = true;
      setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 1800);
    }
    showToast(item.name + ' × ' + qty + ' added to cart ✓', 'success');
  }

  /* ══════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════ */

  function renderSpecs(p) {
    var wrap = el('pdSpecs');
    if (!wrap) return;
    var rows = [];
    if (p.category) rows.push(['Category', p.category]);
    if (p.is_bundle) {
      var packLabel = p.display_name;
      if (!packLabel && p.pack_size) {
        packLabel = p.base_quantity && p.base_unit
          ? parseFloat(p.base_quantity) + ' ' + p.base_unit + ' × ' + p.pack_size + ' Pack'
          : p.pack_size + ' Pack';
      }
      if (packLabel) rows.push(['Pack Config', packLabel]);
      if (p.base_quantity && p.pack_size && p.base_unit) {
        rows.push(['Total Quantity', parseFloat(p.base_quantity) * parseInt(p.pack_size, 10) + ' ' + p.base_unit]);
      }
    } else if (p.unit) {
      rows.push(['Unit / Pack', p.unit]);
    }
    if (p.stock !== undefined) {
      rows.push(['Availability', p.stock === 0 ? 'Out of Stock' : p.stock >= 999 ? 'In Stock' : p.stock + ' units left']);
    }
    if (p.mrp && p.mrp > p.price) {
      var d = disc(p.price, p.mrp);
      rows.push(['MRP', '₹' + parseFloat(p.mrp).toFixed(2)]);
      rows.push(['You Save', '₹' + (parseFloat(p.mrp) - parseFloat(p.price)).toFixed(2) + ' (' + d + '% off)']);
    }
    if (p.created_at) {
      var dt = new Date(p.created_at);
      if (!isNaN(dt.getTime())) {
        rows.push(['Listed', dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })]);
      }
    }
    if (!rows.length) { var s = wrap.closest('.pd-specs-section'); if (s) s.style.display = 'none'; return; }
    wrap.innerHTML = rows.map(function (r) {
      return '<div class="pd-spec-row"><span class="pd-spec-key">' + esc(r[0]) + '</span>'
           + '<span class="pd-spec-val">' + esc(String(r[1])) + '</span></div>';
    }).join('');
  }

  function renderProduct(p) {
    var w = el('pdWrap');
    if (!w) return;

    baseProduct  = p;
    selVariant   = null;
    allVariants  = [];
    qty          = 1;
    stopAuto();
    buildImgs(p);

    var d     = disc(p.price, p.mrp);
    var emoji = CE[p.category] || '📦';
    var oos   = (p.stock === 0);

    document.title = p.name + ' — Aqualence Ventures';

    var inCart  = getCart().find(function (c) { return c.id === p.id; });
    var cartQty = inCart ? inCart.quantity : 0;

    /* Price HTML */
    var priceHTML = '<span class="pd-price">₹' + parseFloat(p.price).toFixed(2) + '</span>';
    if (p.mrp && p.mrp > p.price) {
      priceHTML += '<span class="pd-mrp">₹' + parseFloat(p.mrp).toFixed(2) + '</span>'
                + '<span class="pd-save-badge">' + d + '% off</span>';
    }

    /* Main image */
    var imgHTML = imgs.length
      ? '<img id="pdMainImg" src="' + esc(imgs[0]) + '" alt="' + esc(p.name) + '"'
        + ' style="width:100%;height:100%;object-fit:contain;padding:10px;display:block;pointer-events:none"'
        + ' onerror="this.style.display=\'none\';var em=document.getElementById(\'pdMainEmoji\');if(em)em.style.display=\'flex\'">'
      : '';

    /* Build HTML */
    w.innerHTML =
      '<div class="pd-layout">'

      /* Gallery */
      + '<div class="pd-gallery-col">'
      +   '<div class="pd-main-img-wrap" id="pdMainImgWrap">'
      +     imgHTML
      +     '<span id="pdMainEmoji" style="font-size:4rem;display:' + (imgs.length ? 'none' : 'flex')
      +       ';align-items:center;justify-content:center;width:100%;height:100%;pointer-events:none">'
      +       emoji
      +     '</span>'
      +     (d > 0 ? '<span class="pd-discount-badge">-' + d + '%</span>' : '')
      +   '</div>'
      +   '<div class="pd-thumbs" id="pdThumbs" role="tablist" aria-label="Product images" style="display:none"></div>'
      +   '<div class="pd-dots" id="pdDots" role="tablist" aria-label="Image indicators" style="display:none"></div>'
      + '</div>'

      /* Info */
      + '<div class="pd-info-col">'
      +   '<div class="pd-category">' + emoji + ' ' + esc(p.category)
      +     (p.category === 'New Launches' ? '<span class="pd-new-badge">New Launch</span>' : '')
      +   '</div>'
      +   '<h1 class="pd-name">' + esc(p.name) + '</h1>'
      +   '<div class="pd-price-row" id="pdPriceRow">' + priceHTML + '</div>'
      +   '<div class="pd-stock-bar pd-stock-bar--' + (oos ? 'oos' : 'in') + '" id="pdStockBar">'
      +     (oos ? '❌ Out of Stock' : '✅ In Stock')
      +   '</div>'
      +   (p.description
        ? '<div class="pd-desc-section"><h3 class="pd-section-title">About this product</h3>'
          + '<p class="pd-desc">' + esc(p.description) + '</p></div>'
        : '')
      +   (p.is_bundle
        ? (function() {
            var pillLabel = p.display_name;
            if (!pillLabel && p.pack_size) {
              pillLabel = p.base_quantity && p.base_unit
                ? parseFloat(p.base_quantity) + ' ' + p.base_unit + ' × ' + p.pack_size + ' Pack'
                : p.pack_size + ' Pack';
            }
            return pillLabel
              ? '<div class="pd-bundle-pill-wrap"><span class="pd-bundle-pill">' + esc(pillLabel) + '</span></div>'
              : '';
          })()
        : '')
      +   '<div id="pdVariantsWrap" style="display:none"></div>'
      +   '<div class="pd-specs-section"><h3 class="pd-section-title">Product Details</h3>'
      +     '<div id="pdSpecs" class="pd-specs"></div>'
      +   '</div>'
      +   '<div class="pd-cart-row">'
      +     '<div class="pd-nav-btns">'
      +       '<a href="/index.html" class="btn btn-outline btn-sm">← Continue</a>'
      +       '<a href="/cart.html" class="btn btn-ghost btn-sm">🛒 View Cart</a>'
      +     '</div>'
      +     '<div class="pd-qty-atc">'
      +       '<div class="pd-qty-control">'
      +         '<button type="button" class="pd-qty-btn" id="pdQtyMinus" aria-label="Decrease">−</button>'
      +         '<span class="pd-qty-val" id="pdQtyVal">1</span>'
      +         '<button type="button" class="pd-qty-btn" id="pdQtyPlus" aria-label="Increase">+</button>'
      +       '</div>'
      +       '<button type="button" class="btn pd-atc-btn" id="pdAddToCartBtn"'
      +         (oos ? ' style="display:none"' : '') + '>🛒 Add to Cart</button>'
      +       '<button type="button" class="btn btn-ghost btn-lg pd-oos-btn" id="pdOosBtn" disabled'
      +         (oos ? '' : ' style="display:none"') + '>❌ Out of Stock</button>'
      +     '</div>'
      +   '</div>'
      +   (cartQty > 0 ? '<p class="pd-already-in-cart">Already in cart: <strong>' + cartQty + '</strong></p>' : '')
      + '</div>'

      + '</div>';

    /* Attach qty buttons via JS — no onclick= strings */
    var minusBtn = el('pdQtyMinus');
    var plusBtn  = el('pdQtyPlus');
    var atcBtn   = el('pdAddToCartBtn');

    if (minusBtn) {
      minusBtn.addEventListener('click', function () {
        qty = Math.max(1, qty - 1);
        var v = el('pdQtyVal'); if (v) v.textContent = qty;
      });
    }
    if (plusBtn) {
      plusBtn.addEventListener('click', function () {
        qty = Math.min(99, qty + 1);
        var v = el('pdQtyVal'); if (v) v.textContent = qty;
      });
    }
    if (atcBtn) {
      atcBtn.addEventListener('click', addToCart);
      atcBtn.addEventListener('touchend', function (e) {
        e.preventDefault(); addToCart();
      }, { passive: false });
    }

    /* Post-render */
    renderSpecs(p);
    renderGallery();
    updateCartBadge();

    var hdr = el('pdHeaderTitle');
    var bc  = el('pdBreadcrumbName');
    if (hdr) hdr.textContent = p.name.length > 22 ? p.name.slice(0, 20) + '…' : p.name;
    if (bc)  bc.textContent  = p.name;
  }

  /* ── Skeleton ─────────────────────────────────────────────── */
  function showSkeleton() {
    var w = el('pdWrap');
    if (!w) return;
    w.innerHTML = '<div class="pd-layout">'
      + '<div class="pd-gallery-col">'
      +   '<div class="pd-main-img-wrap skeleton" style="aspect-ratio:1"></div>'
      +   '<div style="display:flex;gap:8px;margin-top:10px">'
      +     '<div class="skeleton" style="width:64px;height:64px;border-radius:8px"></div>'
      +     '<div class="skeleton" style="width:64px;height:64px;border-radius:8px"></div>'
      +     '<div class="skeleton" style="width:64px;height:64px;border-radius:8px"></div>'
      +   '</div>'
      + '</div>'
      + '<div class="pd-info-col" style="padding-top:4px">'
      +   '<div class="skeleton" style="height:13px;width:90px;border-radius:4px;margin-bottom:14px"></div>'
      +   '<div class="skeleton" style="height:26px;width:88%;border-radius:4px;margin-bottom:8px"></div>'
      +   '<div class="skeleton" style="height:26px;width:68%;border-radius:4px;margin-bottom:20px"></div>'
      +   '<div class="skeleton" style="height:50px;width:100%;border-radius:999px;margin-top:24px"></div>'
      + '</div>'
      + '</div>';
  }

  function showError(msg) {
    var w = el('pdWrap');
    if (!w) return;
    w.innerHTML = '<div class="empty-state" style="padding:60px 20px;grid-column:1/-1">'
      + '<div class="icon">😕</div><h3>Product not found</h3>'
      + '<p>' + esc(msg) + '</p>'
      + '<a href="index.html" class="btn btn-primary" style="margin-top:16px">← Back to Products</a>'
      + '</div>';
  }

  /* ── Styles ───────────────────────────────────────────────── */
  function injectStyles() {
    if (el('pdDynStyles')) return;
    var s = document.createElement('style');
    s.id = 'pdDynStyles';
    s.textContent = [
      /* Gallery arrows */
      '.pd-gallery-arrow{position:absolute;top:50%;transform:translateY(-50%);z-index:10;',
      'width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.88);',
      'border:1px solid rgba(0,0,0,.1);font-size:1.4rem;font-weight:700;color:#333;',
      'display:flex;align-items:center;justify-content:center;cursor:pointer;',
      'box-shadow:0 2px 8px rgba(0,0,0,.15);touch-action:manipulation;',
      '-webkit-tap-highlight-color:transparent;}',
      '.pd-gallery-arrow:active{background:#fff;transform:translateY(-50%) scale(.92);}',
      '.pd-gallery-prev{left:10px;}.pd-gallery-next{right:10px;}',
      '@media(max-width:480px){.pd-gallery-arrow{width:32px;height:32px;font-size:1.1rem;}}',

      /* Stock bar */
      '.pd-stock-bar{display:flex;align-items:center;width:100%;padding:8px 14px;',
      'border-radius:var(--r-sm);font-size:.8rem;font-weight:700;margin-bottom:18px;letter-spacing:.01em;}',
      '.pd-stock-bar--in{background:var(--success-pale);color:var(--success);border:1px solid rgba(30,125,58,.15);}',
      '.pd-stock-bar--oos{background:var(--error-pale);color:var(--error);border:1px solid rgba(192,57,43,.15);}',

      /* ATC button */
      '.pd-atc-btn{background:var(--ink);color:#fff;border:none;border-radius:var(--r-full);',
      'padding:0 22px;min-height:52px;font-size:.92rem;font-weight:700;letter-spacing:.01em;',
      'white-space:nowrap;cursor:pointer;transition:background .15s,transform .1s;',
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent;}',
      '.pd-atc-btn:hover{background:var(--ink-mid);}',
      '.pd-atc-btn:active{transform:scale(.97);}',
      '.pd-atc-btn:disabled{background:var(--border-dark);cursor:not-allowed;transform:none;}',

      /* Bundle pill */
      '.pd-bundle-pill-wrap{margin-bottom:20px;}',
      '.pd-bundle-pill{display:inline-block;padding:9px 24px;border-radius:8px;font-size:.88rem;',
      'font-weight:700;letter-spacing:.03em;color:#fff;background:var(--ink);border:2px solid var(--ink);}',

      /* Section title */
      '.pd-section-title{font-size:.65rem;font-weight:800;text-transform:uppercase;',
      'letter-spacing:.1em;color:var(--ink-soft);margin-bottom:10px;padding-bottom:6px;',
      'border-bottom:1.5px solid var(--border);}',

      /* Variant chips */
      '.pd-variants-section{margin-bottom:22px;}',
      '.pd-variant-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}',
      '.pd-variant-chip{display:flex;flex-direction:column;align-items:center;gap:3px;',
      'padding:8px 14px;border-radius:10px;border:1.5px solid var(--border);',
      'background:var(--surface);cursor:pointer;min-width:72px;text-align:center;',
      'transition:border-color .15s,background .15s;',
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent;}',
      '.pd-variant-chip:hover{border-color:var(--brand);background:var(--brand-ultra);}',
      '.pd-variant-chip.active{border-color:var(--ink);background:var(--ink);color:#fff;',
      'box-shadow:0 2px 8px rgba(0,0,0,.18);}',
      '.pd-variant-chip.active .pd-vc-price{color:rgba(255,255,255,.8);}',
      '.pd-variant-chip.pd-vc-oos{opacity:.45;cursor:not-allowed;}',
      '.pd-vc-name{font-size:.78rem;font-weight:700;line-height:1.2;}',
      '.pd-vc-price{font-size:.72rem;color:var(--brand);font-weight:600;}',
      '.pd-vc-oos-tag{font-size:.62rem;color:var(--error);font-weight:600;margin-top:2px;}',
      '@media(max-width:360px){.pd-variant-chip{padding:7px 10px;min-width:60px;}',
      '.pd-vc-name{font-size:.72rem;}}',

      /* Dot indicators */
      '.pd-dots{justify-content:center;gap:6px;margin-top:8px;padding:2px 0;}',
      '.pd-dot{width:7px;height:7px;border-radius:50%;background:var(--border-dark);',
      'border:none;padding:0;cursor:pointer;transition:background .2s,transform .2s;',
      'touch-action:manipulation;-webkit-tap-highlight-color:transparent;flex-shrink:0;}',
      '.pd-dot.active{background:var(--brand);transform:scale(1.35);}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ══════════════════════════════════════════════════════════
     MAIN — fetch once, render immediately, no extra requests
  ══════════════════════════════════════════════════════════ */

  injectStyles();

  var params = new URLSearchParams(window.location.search);
  var id     = params.get('id');

  if (!id || isNaN(parseInt(id, 10))) {
    showError('No product ID in URL.'); return;  // whole IIFE exits here
  }

  showSkeleton();

  // Use plain fetch — no custom fetcher wrappers that may buffer or alter responses
  fetch(API + '/products/' + encodeURIComponent(id) + '?_t=' + Date.now(), {
    headers: { 'Accept': 'application/json' },
    cache: 'no-store'
  })
  .then(function (res) {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  })
  .then(function (json) {
    if (!json.success || !json.data) throw new Error(json.message || 'Product not found');

    var p = json.data;

    // Render product immediately
    renderProduct(p);

    // Variants already embedded in response from backend getOne
    var v = Array.isArray(p.variants)
      ? p.variants.filter(function (x) { return x.is_active !== 0 && x.is_active !== false; })
      : [];

    if (v.length) {
      renderVariants(v);
    }
  })
  .catch(function (err) {
    console.error('[product.js]', err);
    showError('Could not load product. Please check your connection and try again.');
  });

}()); // end IIFE
