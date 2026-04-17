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
      '.va-row{border:1px solid var(--border);border-radius:8px;margin-bottom:8px;',
      'background:var(--surface,#fafafa);overflow:hidden}',
      '.va-row-main{display:grid;gap:6px;align-items:end;padding:10px;',
      'grid-template-columns:1.6fr 1fr 1fr 1fr 28px}',
      '@media(max-width:640px){.va-row-main{grid-template-columns:1fr 1fr;gap:8px}',
      '.va-cell-remove{grid-column:1/-1;display:flex;justify-content:flex-end}}',
      '.va-cell label{display:block;font-size:.6rem;font-weight:700;text-transform:uppercase;',
      'letter-spacing:.05em;color:var(--ink-soft);margin-bottom:3px;cursor:default}',
      '.va-cell input,.va-cell select{width:100%;height:32px;padding:0 8px;font-size:.82rem;',
      'border:1px solid var(--border);border-radius:6px;',
      'background:var(--bg,#fff);color:var(--ink);box-sizing:border-box}',
      '.va-cell input:focus,.va-cell select:focus{outline:none;border-color:var(--sage,#4caf50)}',
      '.va-remove{width:28px;height:28px;border-radius:50%;',
      'background:var(--error-pale,#fde8e8);color:var(--error,#c0392b);',
      'border:1px solid transparent;font-size:1.1rem;line-height:1;',
      'cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}',
      '.va-remove:hover{background:var(--error,#c0392b);color:#fff}',
      '.va-bundle-toggle{display:flex;align-items:center;gap:8px;padding:7px 10px;',
      'background:rgba(21,101,168,.05);border-top:1px solid var(--border);',
      'cursor:pointer;user-select:none}',
      '.va-bundle-toggle input[type=checkbox]{display:none}',
      '.va-bundle-sw{position:relative;width:36px;height:20px;flex-shrink:0;',
      'background:#ccc;border-radius:10px;transition:background .22s}',
      '.va-bundle-sw::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;',
      'border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .22s}',
      '.va-bundle-toggle input:checked~.va-bundle-sw{background:linear-gradient(135deg,#1565a8,#43a047)}',
      '.va-bundle-toggle input:checked~.va-bundle-sw::after{transform:translateX(16px)}',
      '.va-bundle-lbl{font-size:.75rem;font-weight:600;color:var(--ink)}',
      '.va-bundle-fields{max-height:0;overflow:hidden;opacity:0;transition:max-height .3s ease,opacity .22s ease}',
      '.va-bundle-fields.open{max-height:200px;opacity:1}',
      '.va-bundle-inner{display:grid;grid-template-columns:1fr 80px 1fr 1.5fr;gap:6px;',
      'padding:8px 10px 10px;border-top:1px dashed var(--border)}',
      '@media(max-width:560px){.va-bundle-inner{grid-template-columns:1fr 1fr}}',
      '.va-bundle-inner .va-dn{background:rgba(21,101,168,.05);color:var(--ink-soft);font-style:italic}',
      '.va-empty{text-align:center;padding:14px 10px;color:var(--ink-soft);',
      'font-size:.8rem;border:1.5px dashed var(--border);border-radius:8px;',
      'background:var(--surface,#fafafa)}',
      '.va-hint{font-size:.68rem;color:var(--ink-soft);margin-top:6px;line-height:1.5}',
    ].join('');
    document.head.appendChild(s);
  }());

  function ensureSection() {
    if (document.getElementById('vaSection')) return true;

    var anchor = document.getElementById('vaAnchor');

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

    if (!anchor) {
      var errEl = document.getElementById('productFormError');
      if (errEl && errEl.parentNode) {
        anchor = document.createElement('div');
        anchor.id = 'vaAnchorGenerated';
        errEl.parentNode.insertBefore(anchor, errEl);
      }
    }

    if (!anchor) return false;
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
      + '<p class="va-hint">Each variant gets its own price &amp; stock. Enable Bundle per-variant to configure packs with auto display name.</p>';

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

  function _autoDisplayName(row) {
    var dnEl = row.querySelector('.va-dn');
    if (!dnEl || dnEl.dataset.override === '1') return;
    var productName = (document.getElementById('pName') ? document.getElementById('pName').value : '').trim();
    var qty  = parseFloat(row.querySelector('.va-bq') ? row.querySelector('.va-bq').value : '') || 0;
<<<<<<< HEAD
    var unit = row.querySelector('.va-bu') ? row.querySelector('.va-bu').value : 'PCS';
=======
    var unit = (document.getElementById('pUnitVal') ? document.getElementById('pUnitVal').value : 'PCS');

    // Sync the readonly unit field in the row
    var rowUnitEl = row.querySelector('.va-bu');
    if (rowUnitEl) rowUnitEl.value = unit;

>>>>>>> 3baf371fbe6d8d0c1c87c938fa873bfaf7907f9e
    var pack = parseInt(row.querySelector('.va-bp') ? row.querySelector('.va-bp').value : '', 10) || 0;
    if (qty > 0 && pack > 0) {
      var parts = [];
      if (productName) parts.push(productName);
      parts.push(qty + ' ' + unit + ' x ' + pack);
      dnEl.value = parts.join(' ');
    } else {
      dnEl.value = '';
    }
  }

  window.resetVariants = function () {
    if (!ensureSection()) return;
    var c = document.getElementById('vaContainer');
    if (c) c.innerHTML = '';
    _syncEmpty();
  };

  window.addVariantRow = function (v) {
    if (!ensureSection()) return;
    var c = document.getElementById('vaContainer');
    if (!c) return;

    v = v || {};
<<<<<<< HEAD
    var isBundleEnabled = !!v.is_bundle;
=======
    var isBundleEnabled = !!(v.bundle_enabled || v.is_bundle);
>>>>>>> 3baf371fbe6d8d0c1c87c938fa873bfaf7907f9e

    var row = document.createElement('div');
    row.className = 'va-row';
    if (v.id) row.dataset.vid = String(v.id);

    var mainHtml =
      '<div class="va-row-main">'
      + '<div class="va-cell">'
      +   '<label>Variant Name *'
      +   '<input type="text" class="va-name" name="va-name" placeholder="e.g. 100 GM, 500 ML, 4 Pack"'
      +   ' value="' + _esc(v.variant_name || '') + '">'
      +   '</label>'
      + '</div>'
      + '<div class="va-cell">'
      +   '<label>Price (&#8377;) *'
      +   '<input type="number" class="va-price" name="va-price" placeholder="0.00" min="0.01" step="0.01"'
      +   ' value="' + (v.price != null ? _esc(String(v.price)) : '') + '">'
      +   '</label>'
      + '</div>'
      + '<div class="va-cell">'
      +   '<label>Dist. Price (&#8377;)'
      +   '<input type="number" class="va-dist" name="va-dist" placeholder="Optional" min="0" step="0.01"'
      +   ' value="' + (v.distributor_price != null ? _esc(String(v.distributor_price)) : '') + '">'
      +   '</label>'
      + '</div>'
      + '<div class="va-cell">'
      +   '<label>Stock *'
      +   '<input type="number" class="va-stock" name="va-stock" placeholder="0" min="0"'
      +   ' value="' + (v.stock != null ? _esc(String(v.stock)) : '0') + '">'
      +   '</label>'
      + '</div>'
      + '<div class="va-cell va-cell-remove">'
      +   '<button type="button" class="va-remove" title="Remove">&times;</button>'
      + '</div>'
      + '</div>';

    var bundleToggleHtml =
      '<label class="va-bundle-toggle">'
      + '<input type="checkbox" class="va-bundle-cb" name="va-bundle-cb" aria-label="Enable bundle"' + (isBundleEnabled ? ' checked' : '') + '>'
      + '<span class="va-bundle-sw"></span>'
      + '<span class="va-bundle-lbl">&#128230; Enable Bundle '
      +   '<span style="font-weight:400;font-size:.7rem;color:var(--ink-soft)">'
      +   '(Base Qty &middot; Unit &middot; Pack Size &middot; Display Name)</span>'
      + '</span>'
      + '</label>';

<<<<<<< HEAD
    var unitOpts = ['GM','KG','ML','L','PCS'].map(function(u) {
      return '<option value="' + u + '"' + (((v.base_unit || 'PCS') === u) ? ' selected' : '') + '>' + u + '</option>';
    }).join('');

=======
>>>>>>> 3baf371fbe6d8d0c1c87c938fa873bfaf7907f9e
    var bundleFieldsHtml =
      '<div class="va-bundle-fields' + (isBundleEnabled ? ' open' : '') + '">'
      + '<div class="va-bundle-inner">'
      +   '<div class="va-cell">'
      +     '<label>Base Qty'
      +     '<input type="number" class="va-bq" name="va-bq" placeholder="100" min="0.01" step="0.01"'
      +     ' value="' + (v.base_quantity != null ? _esc(String(v.base_quantity)) : '') + '">'
      +     '</label>'
      +   '</div>'
      +   '<div class="va-cell">'
      +     '<label>Unit'
<<<<<<< HEAD
      +     '<select class="va-bu" name="va-bu">' + unitOpts + '</select>'
=======
      +     '<input type="text" class="va-bu" name="va-bu" readonly style="background:#f0f0f0"'
      +     ' value="' + (v.base_unit || document.getElementById('pUnitVal')?.value || 'PCS') + '">'
>>>>>>> 3baf371fbe6d8d0c1c87c938fa873bfaf7907f9e
      +     '</label>'
      +   '</div>'
      +   '<div class="va-cell">'
      +     '<label>Pack Size'
      +     '<input type="number" class="va-bp" name="va-bp" placeholder="3" min="1" step="1"'
      +     ' value="' + (v.pack_size != null ? _esc(String(v.pack_size)) : '') + '">'
      +     '</label>'
      +   '</div>'
      +   '<div class="va-cell">'
      +     '<label>Display Name <span style="font-weight:400;letter-spacing:0;font-size:.6rem">(auto)</span>'
      +     '<input type="text" class="va-dn" name="va-dn" placeholder="Auto-generated"'
      +     ' value="' + _esc(v.display_name || '') + '" data-override="0">'
      +     '</label>'
      +   '</div>'
      + '</div>'
      + '</div>';

    row.innerHTML = mainHtml + bundleToggleHtml + bundleFieldsHtml;

    /* Remove */
    row.querySelector('.va-remove').addEventListener('click', function () {
      row.remove(); _syncEmpty();
    });

    /* Bundle toggle show/hide */
    var cb = row.querySelector('.va-bundle-cb');
    var bf = row.querySelector('.va-bundle-fields');
    cb.addEventListener('change', function () {
      bf.classList.toggle('open', this.checked);
      if (!this.checked) {
        row.querySelector('.va-bq').value = '';
        row.querySelector('.va-bp').value = '';
        var dn = row.querySelector('.va-dn');
        dn.value = '';
        dn.dataset.override = '0';
      }
    });

    /* Display name: allow manual override; auto-restore if cleared */
    var dnEl = row.querySelector('.va-dn');
    dnEl.addEventListener('input', function () {
      this.dataset.override = this.value.trim() !== '' ? '1' : '0';
    });

    function triggerAutoName() { _autoDisplayName(row); }
    row.querySelector('.va-bq').addEventListener('input', triggerAutoName);
    row.querySelector('.va-bu').addEventListener('change', triggerAutoName);
    row.querySelector('.va-bp').addEventListener('input', triggerAutoName);

    /* Hook product name changes once */
    var pNameEl = document.getElementById('pName');
    if (pNameEl && !pNameEl._vaListenerAttached) {
      pNameEl._vaListenerAttached = true;
      pNameEl.addEventListener('input', function () {
        document.querySelectorAll('#vaContainer .va-row').forEach(function (r) {
          _autoDisplayName(r);
        });
      });
    }

    c.appendChild(row);
    _syncEmpty();

    if (isBundleEnabled) _autoDisplayName(row);

    if (!v.variant_name) {
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
      var bundleCb =  row.querySelector('.va-bundle-cb');

      var price = parseFloat(priceRaw);
      var distP = parseFloat(distRaw);
      var stock = parseInt(stockRaw, 10);

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
        size_value:        sizeValue,
        size_unit:         sizeUnit,
<<<<<<< HEAD
        is_bundle:         false,
=======
        bundle_enabled:    false,
>>>>>>> 3baf371fbe6d8d0c1c87c938fa873bfaf7907f9e
        base_quantity:     null,
        base_unit:         null,
        pack_size:         null,
        display_name:      null,
      };

      if (bundleCb && bundleCb.checked) {
        var bq = parseFloat(row.querySelector('.va-bq') ? row.querySelector('.va-bq').value : '');
<<<<<<< HEAD
        var bu = row.querySelector('.va-bu') ? row.querySelector('.va-bu').value : 'PCS';
        var bp = parseInt(row.querySelector('.va-bp') ? row.querySelector('.va-bp').value : '', 10);
        var dn = (row.querySelector('.va-dn') ? row.querySelector('.va-dn').value : '').trim();
        entry.is_bundle    = true;
        entry.base_quantity = (!isNaN(bq) && bq > 0) ? bq : null;
        entry.base_unit    = bu || 'PCS';
        entry.pack_size    = (!isNaN(bp) && bp > 0) ? bp : null;
        entry.display_name = dn || null;
=======
        var bu = document.getElementById('pUnitVal')?.value || 'PCS';
        var bp = parseInt(row.querySelector('.va-bp') ? row.querySelector('.va-bp').value : '', 10);
        var dn = (row.querySelector('.va-dn') ? row.querySelector('.va-dn').value : '').trim();
        entry.bundle_enabled = true;
        entry.base_quantity  = (!isNaN(bq) && bq > 0) ? bq : null;
        entry.base_unit      = bu;
        entry.pack_size      = (!isNaN(bp) && bp > 0) ? bp : null;
        entry.display_name   = dn || null;
>>>>>>> 3baf371fbe6d8d0c1c87c938fa873bfaf7907f9e
      }

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
