/**
 * frontend/js/auth-utils.js
 * ─────────────────────────────────────────────────────────────────
 * Shared auth helpers for all portals (admin / salesman / delivery).
 *
 * Replaces 5+ copy-pasted mobile_code redemption blocks across:
 *   admin/js/admin.js    (direct login, MFA verify, SMS OTP paths)
 *   salesman/js/salesman.js
 *   delivery/js/delivery.js
 *
 * Usage in each login success handler:
 *
 *   const bearer = await AqAuth.redeemMobileCode(data, API);
 *   sessionStorage.setItem('aq_admin_user', JSON.stringify(data.user));
 *   const dest = data.user.must_change_password
 *     ? '/admin/change-password.html'
 *     : AqAuth.buildRedirectUrl('/admin/dashboard.html', bearer);
 *   window.location.replace(dest);
 *
 * ─────────────────────────────────────────────────────────────────
 */

'use strict';

// FIX: Assign to window explicitly so the object is accessible across all <script> tags.
// `var` at top-level IS window property, but being explicit prevents edge cases
// in strict module environments and makes the intent clear.
var AqAuth = window.AqAuth = (function () {

  /* ── WebView Detection ─────────────────────────────────────────────────
   * Android WebView user-agent contains 'wv)' in the UA string.
   * Chrome on Android does NOT contain 'wv)'.
   * iOS WKWebView does not expose a reliable flag; iOS Safari ITP is handled
   * separately by SameSite=None + Secure cookies on the backend.
   * ──────────────────────────────────────────────────────────────────── */
  var _isWebView = (function () {
    var ua = navigator.userAgent || '';
    // Android WebView: Chrome UA with 'wv)' marker
    if (/wv\)/.test(ua) && /Android/.test(ua)) return true;
    // Android without any Chrome version string (older WebView builds)
    if (/Android/.test(ua) && !/Chrome/.test(ua)) return true;
    return false;
  })();

  /* ── redeemMobileCode ──────────────────────────────────────────────────
   * Exchange the single-use mobile_code from a login response for the JWT.
   * Stores result in localStorage + sessionStorage mirror for Bearer fallback.
   *
   * @param  {object} data     - The JSON body of a successful login response
   * @param  {string} apiBase  - e.g. window.API_BASE or '' for same-origin
   * @returns {Promise<string>} - The JWT string, or '' if not applicable/failed
   * ──────────────────────────────────────────────────────────────────── */
  async function redeemMobileCode(data, apiBase) {
    // Only run on WebView or when the server explicitly sends a mobile_code.
    // Desktop Chrome uses the httpOnly cookie — no localStorage token needed.
    if (!data || !data.mobile_code) return '';

    try {
      var url = (apiBase || '') + '/api/v1/auth/mobile-token/' + data.mobile_code;
      var tr = await fetch(url, { credentials: 'include' });
      if (!tr.ok) return '';

      var td = await tr.json();
      if (!td || !td.token) return '';

      // Persist for Bearer fallback on subsequent page loads
      try { localStorage.setItem('aq_mobile_token', td.token); } catch (_) {}
      try { sessionStorage.setItem('aq_mobile_token_mirror', td.token); } catch (_) {}

      return td.token;
    } catch (_) {
      return '';
    }
  }

  /* ── buildRedirectUrl ──────────────────────────────────────────────────
   * Appends the bearer token as a URL hash (#aqt=...) ONLY for WebView
   * clients where sessionStorage may not survive location.replace().
   *
   * On desktop or non-WebView mobile: returns base unmodified — the
   * httpOnly cookie handles auth on the next page without token in URL.
   *
   * @param  {string} base   - e.g. '/admin/dashboard.html'
   * @param  {string} token  - JWT from redeemMobileCode, or ''
   * @returns {string}
   * ──────────────────────────────────────────────────────────────────── */
  function buildRedirectUrl(base, token) {
    if (token && _isWebView) {
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
    isWebView:        _isWebView,
    redeemMobileCode: redeemMobileCode,
    buildRedirectUrl: buildRedirectUrl,
    clearMobileAuth:  clearMobileAuth,
  };

  // FIX: Expose on window so all portal scripts (admin.js / salesman.js / delivery.js)
  // can access AqAuth regardless of whether they share the same script scope.
  // Previously this IIFE returned into `var AqAuth` which is fine when the script
  // and its callers are in the same scope — but since each portal script is loaded
  // as a separate <script> tag, the var is not visible across tags unless it is
  // attached to window. This was the root cause of "AqAuth is not defined".
  window.AqAuth = _api;

  return _api;

})();
