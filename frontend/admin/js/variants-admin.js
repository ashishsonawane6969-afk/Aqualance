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
      '.va-row{display:flex;flex-direction:column;gap:6px;padding:10px;',
      'background:var(--surface,#fafafa);border:1px solid var(--border);',
      'border-radius:8px;margin-bottom:6px}',
      '.va-main{display:grid;gap:6px;align-items:end;',
      'grid-template-columns:1.6fr 1fr 1fr 1fr 1fr 1fr 28px}',
      '@media(max-width:640px){.va-main{grid-template-columns:1fr 1fr;gap:8px}',
      '.va-cell-remove{grid-column:1/-1;display:flex;justify-content:flex-end}}',
      '.va-cell label{display:block;font-size:.6rem;font-weight:700;text-transform:uppercase;',
      'letter-spacing:.05em;color:var(--ink-soft);margin-bottom:3px}',
      '.va-cell input,.va-cell select{width:100%;height:32px;padding:0 8px;font-size:.82rem;',
      'border:1px solid var(--border);border-radius:6px;',
      'background:var(--bg,#fff);color:var(--ink);box-sizing:border-box}',
      '.va-cell input:focus,.va-cell select:focus{outline:none;border-color:var(--sage,#4caf50)}',
      '.va-remove{width:28px;height:28px;border-radius:50%;',
      'background:var(--error-pale,#fde8e8);color:var(--error,#c0392b);',
      'border:1px solid transparent;font-size:1.1rem;line-height:1;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.va-remove:hover{background:var(--error,#c0392b);color:#fff}',
      '.va-bundle-bar{display:flex;align-items:center;gap:8px;padding:4px 2px;border-top:1px solid var(--border)}',
      '.va-bundle-bar label{display:flex;align-items:center;gap:6px;cursor:pointer;',
      'font-size:.72rem;font-weight:600;color:var(--ink-soft);user-select:none}',
      '.va-bundle-bar input[type=checkbox]{width:14px;height:14px;cursor:pointer;',
      'accent-color:var(--sage,#4caf50)}',
      '.va-bundle-fields{display:none;gap:6px;align-items:end;padding-top:4px;',
      'grid-template-columns:1fr 1fr 1fr 1.6fr}',
      '.va-bundle-fields.open{display:grid}',
      '.va-dn-preview{font-size:.7rem;color:var(--ink-soft);padding-top:18px;',
      'white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.va-empty{text-align:center;padding:14px 10px;color:var(--ink-soft);',
      'font-size:.8rem;border:1.5px dashed var(--border);border-radius:8px;',
      'background:var(--surface,#fafafa)}',
      '.va-hint{font-size:.68rem;color:var(--ink-soft);margin-top:6px;line-height:1.5}',
    ].join('');
    document.head.appendChild(s);
  }());

  // FIX: Separate "find anchor" from "build section" so ensureSection is truly idempotent.
  // Previously, ensureSection() was called inside addVariantRow() and resetVariants(),
  // meaning every call attempted to re-inject the section. On slow DOM loads, if the
  // anchor wasn't found on the first call, a second call could inject a second #vaSection.
  // Now we guard strictly: return immediately if #vaSection already exists.
  function ensureSection() {
    // STRICT guard — if section already injected, do nothing
    if (document.getElementById('vaSection')) return true;

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

    if (!anchor) return false; // DOM not ready

    // Double-check: another async call may have injected the section between our
    // getElementById check above and here (race on slow connections).
    if (document.getElementById('vaSection')) return true;

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

    _syncEmpty();
    return true;
  }

  function _syncEmpty() {
    var c = document.getElementById('vaContainer');
    var e = document.getElementById('vaEmpty');
    if (!c || !e) return;
    var hasRows = c.querySelectorAll('.va-row').length > 0;
    e.style.display = hasRows ? 'none' : '';
  }

  window.resetVariants = function () {
    // FIX: Only call ensureSection once; do not re-call on every reset.
    // If section isn't ready yet, bail — it will be injected on DOMContentLoaded.
    if (!ensureSection()) return;
    var c = document.getElementById('vaContainer');
    if (c) c.innerHTML = '';
    _syncEmpty();
  };

  window.addVariantRow = function (v) {
    // FIX: ensureSection() is idempotent — safe to call, but won't double-inject.
    if (!ensureSection()) return;
    var c = document.getElementById('vaContainer');
    if (!c) return;

    var row = document.createElement('div');
    row.className = 'va-row';
    if (v && v.id) row.dataset.vid = String(v.id);

    var _isB  = !!(v && v.base_quantity);
    var _bq   = (v && v.base_quantity   != null) ? _esc(String(v.base_quantity))   : '';
    var _unit = (v && v.unit            != null) ? String(v.unit).toUpperCase()    : 'ML';
    var _ps   = (v && v.pack_size       != null) ? _esc(String(v.pack_size))       : '';
    var _dn   = (v && v.display_name    != null) ? _esc(String(v.display_name))    : '';
    var _cat  = (v && v.category        != null) ? _esc(String(v.category))        : '';
    var _disc = (v && v.discount_price  != null) ? _esc(String(v.discount_price))  : '';
    var _UNITS = ['ML','L','GM','KG','PCS'];

    row.innerHTML =
      '<div class="va-main">'
      + '<div class="va-cell">'
      +   '<label>Variant Name *</label>'
      +   '<input type="text" class="va-name" placeholder="e.g. 500ml, 4 Pack"'
      +   ' value="' + _esc(v && v.variant_name ? v.variant_name : '') + '">'
      + '</div>'
      + '<div class="va-cell">'
      +   '<label>Category</label>'
      +   '<input type="text" class="va-cat" placeholder="e.g. Jar"'
      +   ' value="' + _cat + '">'
      + '</div>'
      + '<div class="va-cell">'
      +   '<label>Price (₹) *</label>'
      +   '<input type="number" class="va-price" placeholder="0.00" min="0.01" step="0.01"'
      +   ' value="' + (v && v.price != null ? _esc(String(v.price)) : '') + '">'
      + '</div>'
      + '<div class="va-cell">'
      +   '<label>Discount (₹)</label>'
      +   '<input type="number" class="va-disc" placeholder="Optional" min="0" step="0.01"'
      +   ' value="' + _disc + '">'
      + '</div>'
      + '<div class="va-cell">'
      +   '<label>Dist. Price (₹)</label>'
      +   '<input type="number" class="va-dist" placeholder="Optional" min="0" step="0.01"'
      +   ' value="' + (v && v.distributor_price != null ? _esc(String(v.distributor_price)) : '') + '">'
      + '</div>'
      + '<div class="va-cell">'
      +   '<label>Stock *</label>'
      +   '<input type="number" class="va-stock" placeholder="0" min="0"'
      +   ' value="' + (v && v.stock != null ? _esc(String(v.stock)) : '0') + '">'
      + '</div>'
      + '<div class="va-cell va-cell-remove">'
      +   '<button type="button" class="va-remove" title="Remove">\u00d7</button>'
      + '</div>'
      + '</div>'
      // bundle toggle bar
      + '<div class="va-bundle-bar">'
      +   '<label>'
      +     '<input type="checkbox" class="va-bundle-chk"' + (_isB ? ' checked' : '') + '>'
      +     ' \u{1f4e6} Bundle / Pack'
      +   '</label>'
      + '</div>'
      // bundle fields
      + '<div class="va-bundle-fields' + (_isB ? ' open' : '') + '">'
      +   '<div class="va-cell"><label>Base Qty</label>'
      +     '<input type="number" class="va-bq" placeholder="e.g. 500" min="0.01" step="0.01"'
      +     ' value="' + _bq + '">'
      +   '</div>'
      +   '<div class="va-cell"><label>Unit</label>'
      +     '<select class="va-unit">'
      +     _UNITS.map(function(u){return '<option value="'+u+'"'+(_unit===u?' selected':'')+'>'+u+'</option>';}).join('')
      +     '</select>'
      +   '</div>'
      +   '<div class="va-cell"><label>Pack Size</label>'
      +     '<input type="number" class="va-ps" placeholder="e.g. 6" min="1" step="1"'
      +     ' value="' + _ps + '">'
      +   '</div>'
      +   '<div class="va-cell"><div class="va-dn-preview">'
      +     (_dn ? '\u2192 ' + _dn : '<em style="opacity:.5">display name preview</em>')
      +   '</div></div>'
      + '</div>';

    // remove button
    row.querySelector('.va-remove').addEventListener('click', function () {
      row.remove(); _syncEmpty();
    });

    // bundle toggle: show/hide bundle fields & auto-compute display_name
    var _chk = row.querySelector('.va-bundle-chk');
    var _bf  = row.querySelector('.va-bundle-fields');
    function _toggleBundle() {
      if (_chk.checked) { _bf.classList.add('open'); } else { _bf.classList.remove('open'); }
    }
    function _updateDN() {
      if (!_chk.checked) return;
      var nameEl = row.querySelector('.va-name');
      var bqEl   = row.querySelector('.va-bq');
      var uEl    = row.querySelector('.va-unit');
      var psEl   = row.querySelector('.va-ps');
      var dnEl   = row.querySelector('.va-dn-preview');
      var n  = nameEl ? nameEl.value.trim() : '';
      var bq = bqEl  ? bqEl.value.trim()   : '';
      var u  = uEl   ? uEl.value            : '';
      var ps = psEl  ? psEl.value.trim()   : '';
      var dn = '';
      if (n && bq && u) { dn = n + ' ' + bq + u + (ps ? ' x ' + ps : ''); }
      if (dnEl) dnEl.innerHTML = dn ? '\u2192 ' + _esc(dn) : '<em style="opacity:.5">display name preview</em>';
    }
    _chk.addEventListener('change', function () { _toggleBundle(); _updateDN(); });
    ['va-name','va-bq','va-ps'].forEach(function(cls) {
      var el = row.querySelector('.' + cls);
      if (el) el.addEventListener('input', _updateDN);
    });
    var _uEl = row.querySelector('.va-unit');
    if (_uEl) _uEl.addEventListener('change', _updateDN);

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
      var name     = (row.querySelector('.va-name') ? row.querySelector('.va-name').value : '').trim();
      var priceRaw =  row.querySelector('.va-price') ? row.querySelector('.va-price').value : '';
      var distRaw  =  row.querySelector('.va-dist')  ? row.querySelector('.va-dist').value  : '';
      var discRaw  =  row.querySelector('.va-disc')  ? row.querySelector('.va-disc').value  : '';
      var stockRaw =  row.querySelector('.va-stock') ? row.querySelector('.va-stock').value : '0';
      var cat      = (row.querySelector('.va-cat')  ? row.querySelector('.va-cat').value   : '').trim();
      var isBundle = row.querySelector('.va-bundle-chk') && row.querySelector('.va-bundle-chk').checked;
      var bqRaw    = isBundle && row.querySelector('.va-bq')   ? row.querySelector('.va-bq').value   : '';
      var unitVal  = isBundle && row.querySelector('.va-unit') ? row.querySelector('.va-unit').value  : '';
      var psRaw    = isBundle && row.querySelector('.va-ps')   ? row.querySelector('.va-ps').value    : '';

      var price  = parseFloat(priceRaw);
      var distP  = parseFloat(distRaw);
      var discP  = parseFloat(discRaw);
      var stock  = parseInt(stockRaw, 10);
      var bq     = parseFloat(bqRaw);
      var ps     = parseInt(psRaw, 10);

      // Skip rows with no name or invalid price
      if (!name || isNaN(price) || price <= 0) return;

      // auto size_value / size_unit from variant name
      var sizeValue = 0;
      var sizeUnit  = 'PCS';
      var m = name.match(/^([\d.]+)\s*(g|gm|ml|kg|l|pcs)?/i);
      if (m) {
        sizeValue = parseFloat(m[1]) || 0;
        var unitMap = { g:'GM', gm:'GM', ml:'ML', kg:'KG', l:'L', pcs:'PCS' };
        sizeUnit = unitMap[(m[2] || '').toLowerCase()] || 'PCS';
      }

      // auto display_name when bundle
      var displayName = null;
      if (isBundle && name && !isNaN(bq) && bq > 0 && unitVal) {
        displayName = name + ' ' + bq + unitVal + (!isNaN(ps) && ps > 1 ? ' x ' + ps : '');
      }

      var entry = {
        variant_name:      name,
        price:             price,
        distributor_price: (!isNaN(distP) && distP > 0) ? distP : null,
        discount_price:    (!isNaN(discP) && discP > 0) ? discP : null,
        stock:             isNaN(stock) ? 0 : Math.max(0, stock),
        size_value:        sizeValue,
        size_unit:         sizeUnit,
        category:          cat || null,
        base_quantity:     (isBundle && !isNaN(bq) && bq > 0) ? bq : null,
        unit:              (isBundle && unitVal) ? unitVal : null,
        pack_size:         (isBundle && !isNaN(ps) && ps > 0) ? ps : null,
        display_name:      displayName,
      };
      if (row.dataset.vid) entry.id = parseInt(row.dataset.vid, 10);
      variants.push(entry);
    });
    return variants;
  };

  // FIX: On DOMContentLoaded, attempt injection once.
  // All subsequent calls (addVariantRow, resetVariants) are guarded by the
  // getElementById('vaSection') check at the top of ensureSection().
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSection);
  } else {
    ensureSection();
  }
}());
