/* ─── cart.js — Mobile-first ───────────────────────────────── */

// catEmoji is defined in app.js
const _cartCatEmoji = {
  'Face Care':'💆','Hair Care':'💇','Body Care':'🧴',
  'Essentials':'🧼','New Launches':'🆕','General':'📦'
};

function renderCart() {
  const layout = document.getElementById('cartLayout');
  if (!layout) return;
  const cart = getCart();

  if (!cart.length) {
    layout.innerHTML = `
      <div class="cart-empty" style="padding:60px 20px;text-align:center">
        <div class="icon" style="font-size:3.5rem;margin-bottom:12px">🛒</div>
        <h3 style="font-family:var(--font-head);font-size:1.1rem;margin-bottom:8px;color:var(--ink)">Your cart is empty</h3>
        <p style="color:var(--ink-soft);font-size:.85rem;margin-bottom:20px">Add iKrish wellness products to get started.</p>
        <a href="index.html" class="btn btn-primary">🛍 Browse Products</a>
      </div>`;
    return;
  }

  const subtotal = cartTotal();
  const total    = subtotal;

  layout.innerHTML = `
    <div class="cart-list">
      ${cart.map(item => `
        <div class="cart-item" id="cartItem-${item.id}">
          <div class="cart-item-img">
            ${item.image
              ? `<img src="${item.image}" alt="${item.name}" onerror="this.style.display='none'">`
              : `<span style="font-size:1.5rem">${_cartCatEmoji[item.category]||'📦'}</span>`}
          </div>
          <div class="cart-item-info">
            <div class="cart-item-name">${item.name}</div>
            <div class="cart-item-price">₹${parseFloat(item.price).toFixed(2)} / ${item.unit||'pc'}</div>
            <div class="cart-item-controls">
              <div class="qty-row">
                <button class="qty-btn" onclick="updateCartQty(${item.id},-1)">−</button>
                <span class="qty-val">${item.quantity}</span>
                <button class="qty-btn" onclick="updateCartQty(${item.id},1)">+</button>
              </div>
              <div>
                <span style="font-weight:700;color:var(--brand)">₹${(item.price*item.quantity).toFixed(2)}</span>
                <button class="remove-btn" onclick="removeItem(${item.id})" style="margin-left:8px">✕</button>
              </div>
            </div>
          </div>
        </div>`).join('')}
      <button onclick="clearCart()" class="btn btn-ghost btn-sm" style="margin-top:4px">🗑 Clear Cart</button>
    </div>

    <div class="cart-summary-box" style="margin:0 12px 12px">
      <div class="summary-row" style="padding:12px 14px 8px;font-weight:700;font-size:.85rem;color:var(--ink);border-bottom:1px solid var(--border);">🧾 Order Summary</div>
      ${cart.map(i=>`
        <div class="summary-row">
          <span>${i.name} × ${i.quantity}</span>
          <span>₹${(i.price*i.quantity).toFixed(2)}</span>
        </div>`).join('')}
      <div class="summary-row">
        <span>Subtotal</span><span>₹${subtotal.toFixed(2)}</span>
      </div>
      <div class="summary-row">
        <span>Delivery</span><span style="color:var(--success);font-weight:600">FREE</span>
      </div>
      <div class="summary-row total" style="font-weight:700;font-size:.95rem;color:var(--ink);background:var(--brand-ultra);padding:12px 14px;margin-top:0;border-top:1.5px solid var(--border);">
        <span>Total</span><span>₹${total.toFixed(2)}</span>
      </div>
    </div>

    <div style="padding:0 12px 20px;display:flex;flex-direction:column;gap:8px;">
      <a href="checkout.html" class="btn btn-primary btn-lg btn-full">Proceed to Checkout →</a>
      <a href="index.html" class="btn btn-outline btn-full">← Continue Shopping</a>
    </div>`;
}

function updateCartQty(id, delta) {
  const cart = getCart();
  const item = cart.find(i => i.id === id);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) cart.splice(cart.indexOf(item), 1);
  saveCart(cart);
  renderCart();
}
function removeItem(id) { removeFromCart(id); renderCart(); showToast('Item removed'); }
function clearCart() { if (confirm('Remove all items?')) { saveCart([]); renderCart(); } }

renderCart();
