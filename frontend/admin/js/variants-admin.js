/* ═══════════════════════════════════════════════════════════════
   variants-admin.js  —  Variant UI for Admin Product Modal
   Exposes globals: resetVariants(), addVariantRow(v), getVariantsPayload()
   Loaded AFTER admin.js on products admin page.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function _esc(str) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(str != null ? String(str) : ''));
    return d.innerHTML;
  }

  (function injectStyles() {
    if (document.getElementById('variantAdminStyle')) return;
    var s = document.createElement('style');
    s.id = 'variantAdminStyle';
    s.textContent = [
      '.va-section{margin:20px 0 14px}',
      '.va-header{display:flex;align-items:center;justify-content:space-between;',
      'margin-bottom:10px;padding-bottom:8px;border-bottom:1.5px solid var(--border)}',
      '.va-title{font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-soft)}',
      '.va-row{display:grid;gap:6px;align-items:end;padding:10px;',
      'background:var(--surface,#fafafa);border:1px solid var(--border);',
      'border-radius:8px;margin-bottom:6px;grid-template-columns:1.6fr 1fr 1fr 1fr 1fr 28px}',
      '@media(max-width:640px){.va-row{grid-template-columns:1fr 1fr;gap:8px}',
      '.va-cell-remove{grid-column:1/-1;display:flex;justify-content:flex-end}}',
      '.va-cell label{display:block;font-size:.6rem;font-weight:700;text-transform:uppercase;',
      'letter-spacing:.05em;color:var(--ink-soft);margin-bottom:3px}',
      '.va-cell input{width:100%;height:32px;padding:0 8px;font-size:.82rem;',
      'border:1px solid var(--border);border-radius:6px;',
      'background:var(--bg,#fff);color:var(--ink);box-sizing:border-box}',
      '.va-cell input:focus{outline:none;border-color:var(--sage,#4caf50)}',
      '.va-remove{width:28px;height:28px;border-radius:50%;',
      'background:var(--error-pale,#fde8e8);color:var(--error,#c0392b);',
      'border:1px solid transparent;font-size:1.1rem;line-height:1;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.va-remove:hover{background:var(--error,#c0392b);color:#fff}',
      '.va-empty{text-align:center;padding:14px 10px;color:var(--ink-soft);',
      'font-size:.8rem;border:1.5px dashed var(--border);border-radius:8px;',
      'background:var(--surface,#fafafa)}',
      '.va-hint{font-size:.68rem;color:var(--ink-soft);margin-top:6px;line-height:1.5}',
    ].join('');
    document.head.appendChild(s);
  }());

  function ensureSection() {
    if (document.getElementById('vaSection')) return;

    // Primary anchor: explicit placeholder div injected in products.html
    var anchor = document.getElementById('vaAnchor');

    // Fallback 1: create anchor node after pStock's form-group
    if (!anchor) {
      var stockEl = document.getElementById('pStock');
      if (stockEl) {
        var fg = stockEl.closest('.form-group');
        if (fg && fg.parentNode) {
          anchor = document.createElement('div');
          anchor.id = 'vaAnchorGenerated';
          fg.parentNode.insertBefore(anchor, fg.nextSibling);
        }
      }
    }

    // Fallback 2: insert anchor before form error div
    if (!anchor) {
      var errEl = document.getElementById('productFormError');
      if (errEl && errEl.parentNode) {
        anchor = document.createElement('div');
        anchor.id = 'vaAnchorGenerated';
        errEl.parentNode.insertBefore(anchor, errEl);
      }
    }

    if (!anchor) return; // DOM not ready — will retry on DOMContentLoaded

    var sec = document.createElement('div');
    sec.id = 'vaSection';
    sec.className = 'va-section';
    sec.innerHTML =
      '<div class="va-header">'
      + '<span class="va-title">Variants <span style="font-weight:400;font-size:.68rem">(optional)</span></span>'
      + '<button type="button" class="btn btn-outline btn-sm" id="vaAddBtn">+ Add Variant</button>'
      + '</div>'
      + '<div id="vaContainer"></div>'
      + '<div id="vaEmpty" class="va-empty">'
      +   'No variants — product sells as single unit at the base price.'
      + '</div>'
      + '<p class="va-hint">Each variant gets its own price &amp; stock. Leave empty to use base price only.</p>';

    // Insert AFTER the anchor so the section appears below it
    if (anchor.nextSibling) {
      anchor.parentNode.insertBefore(sec, anchor.nextSibling);
    } else {
      anchor.parentNode.appendChild(sec);
    }

    document.getElementById('vaAddBtn').addEventListener('click', function () {
      window.addVariantRow();
    });

    // Sync empty state after injection
    _syncEmpty();
  }

  function _syncEmpty() {
    var c = document.getElementById('vaContainer');
    var e = document.getElementById('vaEmpty');
    if (!c || !e) return;
    var hasRows = c.querySelectorAll('.va-row').length > 0;
    e.style.display = hasRows ? 'none' : '';
  }

  window.resetVariants = function () {
    ensureSection();
    var c = document.getElementById('vaContainer');
    if (c) c.innerHTML = '';
    _syncEmpty();
  };

  window.addVariantRow = function (v) {
    ensureSection();
    var c = document.getElementById('vaContainer');
    if (!c) return;

    var row = document.createElement('div');
    row.className = 'va-row';
    if (v && v.id) row.dataset.vid = String(v.id);

    row.innerHTML =
      '<div class="va-cell">'
      + '<label>Variant Name *</label>'
      + '<input type="text" class="va-name" name="va_name" placeholder="e.g. 75g, 100ml, 4 Pack"'
      + ' value="' + _esc(v && v.variant_name ? v.variant_name : '') + '">'
      + '</div>'
      + '<div class="va-cell">'
      + '<label>Price (₹) *</label>'
      + '<input type="number" class="va-price" name="va_price" placeholder="0.00" min="0.01" step="0.01"'
      + ' value="' + (v && v.price != null ? _esc(String(v.price)) : '') + '">'
      + '</div>'
      + '<div class="va-cell">'
      + '<label>Dist. Price (₹)</label>'
      + '<input type="number" class="va-dist" name="va_dist" placeholder="Optional" min="0" step="0.01"'
      + ' value="' + (v && v.distributor_price != null ? _esc(String(v.distributor_price)) : '') + '">'
      + '</div>'
      + '<div class="va-cell">'
      + '<label>Stock</label>'
      + '<input type="number" class="va-stock" name="va_stock" placeholder="0" min="0"'
      + ' value="' + (v && v.stock != null ? _esc(String(v.stock)) : '0') + '">'
      + '</div>'
      + '<div class="va-cell">'
      + '<label>SKU</label>'
      + '<input type="text" class="va-sku" name="va_sku" placeholder="Optional"'
      + ' value="' + _esc(v && v.sku ? v.sku : '') + '">'
      + '</div>'
      + '<div class="va-cell va-cell-remove">'
      + '<button type="button" class="va-remove" title="Remove">×</button>'
      + '</div>';

    row.querySelector('.va-remove').addEventListener('click', function () {
      row.remove(); _syncEmpty();
    });

    c.appendChild(row);
    _syncEmpty();

    if (!v || !v.variant_name) {
      setTimeout(function () {
        var inp = row.querySelector('.va-name');
        if (inp) inp.focus();
      }, 50);
    }
  };

  window.getVariantsPayload = function () {
    var rows = document.querySelectorAll('#vaContainer .va-row');
    var variants = [];
    rows.forEach(function (row) {
      var name     = (row.querySelector('.va-name')  ? row.querySelector('.va-name').value  : '').trim();
      var priceRaw =  row.querySelector('.va-price') ? row.querySelector('.va-price').value  : '';
      var distRaw  =  row.querySelector('.va-dist')  ? row.querySelector('.va-dist').value   : '';
      var stockRaw =  row.querySelector('.va-stock') ? row.querySelector('.va-stock').value  : '0';
      var sku      = (row.querySelector('.va-sku')   ? row.querySelector('.va-sku').value    : '').trim();

      var price    = parseFloat(priceRaw);
      var distP    = parseFloat(distRaw);
      var stock    = parseInt(stockRaw, 10);

      if (!name || isNaN(price) || price <= 0) return;

      var sizeValue = 0;
      var sizeUnit  = 'PCS';
      var m = name.match(/^([\d.]+)\s*(g|gm|ml|kg|l|pcs)?/i);
      if (m) {
        sizeValue = parseFloat(m[1]) || 0;
        var unitMap = { g:'GM', gm:'GM', ml:'ML', kg:'KG', l:'L', pcs:'PCS' };
        sizeUnit = unitMap[(m[2] || '').toLowerCase()] || 'PCS';
      }

      var entry = {
        variant_name:      name,
        price:             price,
        distributor_price: (!isNaN(distP) && distP > 0) ? distP : null,
        stock:             isNaN(stock) ? 0 : Math.max(0, stock),
        sku:               sku || null,
        size_value:        sizeValue,
        size_unit:         sizeUnit,
      };
      if (row.dataset.vid) entry.id = parseInt(row.dataset.vid, 10);
      variants.push(entry);
    });
    return variants;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSection);
  } else {
    ensureSection();
  }
}());
