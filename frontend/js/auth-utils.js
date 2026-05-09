/**
 * frontend/js/auth-utils.js
 * ─────────────────────────────────────────────────────────────────
 * Shared auth helpers for all portals (admin / salesman / delivery).
 *
 * FIX (mobile Chrome login loop):
 *   buildRedirectUrl previously only appended #aqt= token for _isWebView.
 *   Mobile Chrome is NOT detected as WebView (no 'wv)' in UA), but it ALSO
 *   blocks cross-origin httpOnly cookies on cross-site fetches after navigation.
 *   Result: token stored in localStorage, page navigates, new JS context,
 *   _mobileAuthHeaders() finds nothing, /auth/me → 401 → redirect loop.
 *
 *   Fix: use #aqt= URL hash handoff for ANY mobile browser (not just WebView).
 *   Desktop Chrome/Firefox on real desktop skips hash (cookie works).
 *   Detection now uses pointer accuracy (coarse = touch device = mobile).
 * ─────────────────────────────────────────────────────────────────
 */

var AqAuth = window.AqAuth = (function () {
  'use strict';

  /* ── Device Detection ───────────────────────────────────────────────────
   * FIXED: was `_isWebView` — only caught Android WebView ('wv)' UA marker).
   * Mobile Chrome on Android does NOT have 'wv)' in UA, so it returned false.
   * buildRedirectUrl then skipped the #aqt= hash handoff.
   * After location.replace(), mobile Chrome does NOT reliably pass cookies
   * for cross-origin requests (SameSite=None is honoured for ongoing sessions
   * but the cookie store is not always flushed before the new page's first
   * fetch fires — timing race on mobile CPU).
   *
   * NEW DETECTION: any touch-primary device (matchMedia pointer:coarse).
   * This covers: Android Chrome, Android WebView, iOS Safari, iOS WKWebView.
   * Desktop Chrome/Firefox always return pointer:fine → cookie path used.
   * ──────────────────────────────────────────────────────────────────── */
  var _isMobileClient = (function () {
    var ua = navigator.userAgent || '';

    // Android WebView: explicit wv) marker
    if (/wv\)/.test(ua) && /Android/.test(ua)) return true;
    // Older Android WebView builds without Chrome string
    if (/Android/.test(ua) && !/Chrome/.test(ua)) return true;

    // FIX: mobile Chrome (and all mobile browsers) — use pointer media query.
    // coarse = touch screen = mobile. fine = mouse = desktop.
    // This is the check that was missing and caused the mobile Chrome loop.
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        return true;
      }
    } catch (_) {}

    // Fallback: UA screen width heuristic
    if (window.screen && window.screen.width <= 768) return true;

    return false;
  })();

  /* ── redeemMobileCode ──────────────────────────────────────────────────
   * Exchange the single-use mobile_code from a login response for the JWT.
   * Stores result in localStorage + sessionStorage mirror for Bearer fallback.
   *
   * Called on ALL devices — server always sends mobile_code in login response.
   * On desktop the token is stored but _isMobileClient=false so buildRedirectUrl
   * won't append it to the URL (desktop relies on the httpOnly cookie instead).
   *
   * @param  {object} data     - The JSON body of a successful login response
   * @param  {string} apiBase  - e.g. window.API_BASE or '' for same-origin
   * @returns {Promise<string>} - The JWT string, or '' if not applicable/failed
   * ──────────────────────────────────────────────────────────────────── */
  async function redeemMobileCode(data, apiBase) {
    if (!data || !data.mobile_code) return '';

    try {
      var url = (apiBase || '') + '/api/v1/auth/mobile-token/' + data.mobile_code;
      // NOTE: no `credentials: 'include'` here — this endpoint requires NO auth
      // (the code itself is the credential). Sending credentials would cause a
      // CORS preflight on some mobile Chrome versions and add latency.
      var tr = await fetch(url);
      if (!tr.ok) return '';

      var td = await tr.json();
      if (!td || !td.token) return '';

      // Persist for Bearer fallback on all subsequent page loads
      try { localStorage.setItem('aq_mobile_token', td.token); } catch (_) {}
      try { sessionStorage.setItem('aq_mobile_token_mirror', td.token); } catch (_) {}

      return td.token;
    } catch (_) {
      return '';
    }
  }

  /* ── buildRedirectUrl ──────────────────────────────────────────────────
   * FIXED: was `if (token && _isWebView)` — excluded mobile Chrome.
   *
   * Now appends #aqt= for ANY mobile client (touch-primary device).
   * network.js _mobileAuthHeaders() reads the hash on dashboard load,
   * extracts the token, stores it in localStorage + sessionStorage,
   * then strips it from the URL. This guarantees the token survives
   * location.replace() regardless of mobile browser cookie timing.
   *
   * Desktop: cookie handles auth. No hash appended. Behaviour unchanged.
   *
   * @param  {string} base   - e.g. '/admin/dashboard.html'
   * @param  {string} token  - JWT from redeemMobileCode, or ''
   * @returns {string}
   * ──────────────────────────────────────────────────────────────────── */
  function buildRedirectUrl(base, token) {
    // FIX: was `_isWebView` — now `_isMobileClient` covers mobile Chrome too
    if (token && _isMobileClient) {
      return base + '#aqt=' + encodeURIComponent(token);
    }
    return base;
  }

  /* ── clearMobileAuth ───────────────────────────────────────────────────
   * Remove all Bearer fallback state on logout.
   * Call alongside the server-side cookie clear.
   * ──────────────────────────────────────────────────────────────────── */
  function clearMobileAuth() {
    try { localStorage.removeItem('aq_mobile_token'); } catch (_) {}
    try { sessionStorage.removeItem('aq_mobile_token_mirror'); } catch (_) {}
  }

  /* ── Public API ─────────────────────────────────────────────────────── */
  var _api = {
    isMobileClient:   _isMobileClient,
    isWebView:        _isMobileClient, // back-compat alias — code that checked isWebView still works
    redeemMobileCode: redeemMobileCode,
    buildRedirectUrl: buildRedirectUrl,
    clearMobileAuth:  clearMobileAuth,
  };

  window.AqAuth = _api;
  return _api;

})();
