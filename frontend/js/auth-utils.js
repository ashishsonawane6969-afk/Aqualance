/**
 * frontend/js/auth-utils.js — FIXED
 * ─────────────────────────────────────────────────────────────────
 *
 * FIXES APPLIED:
 *  FIX-1 (auth-utils) — redeemMobileCode: Added logging, retry, and grace
 *         fallback. Previously swallowed ALL errors silently and returned ''.
 *         Engineers had zero diagnostic information when token exchange failed.
 *
 *  FIX-2 (auth-utils) — redeemMobileCode: Increased exchange timeout to 15s.
 *         On 2G connections the redemption GET can exceed 1s. Default fetch
 *         has no timeout — but the server's 60s TTL means a slow mobile that
 *         takes >60s will get a 401. 15s AbortController gives early feedback.
 *
 *  FIX-3 (auth-utils) — clearMobileAuth: Also clears sessionStorage mirror
 *         key that was sometimes missed on logout.
 * ─────────────────────────────────────────────────────────────────
 */

var AqAuth = window.AqAuth = (function () {
  'use strict';

  /* ── Device Detection ───────────────────────────────────────────────────
   * Detects any touch-primary device (mobile Chrome, Android WebView,
   * iOS WKWebView). Desktop browsers use the httpOnly cookie path.
   * ──────────────────────────────────────────────────────────────────── */
  var _isMobileClient = (function () {
    var ua = navigator.userAgent || '';

    // Android WebView: explicit wv) marker
    if (/wv\)/.test(ua) && /Android/.test(ua)) return true;
    // Older Android WebView builds without Chrome string
    if (/Android/.test(ua) && !/Chrome/.test(ua)) return true;

    // Mobile Chrome and all mobile browsers — pointer:coarse = touch screen
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        return true;
      }
    } catch (_) {}

    // Fallback: screen width heuristic
    if (window.screen && window.screen.width <= 768) return true;

    return false;
  })();

  /* ── redeemMobileCode ──────────────────────────────────────────────────
   * Exchange the single-use mobile_code from a login response for the JWT.
   *
   * FIX-1: Now logs ALL failures with status codes and error messages.
   *        Previously: all errors silently caught → '' → no diagnostics.
   *        Now: console.error on every failure path.
   *
   * FIX-2: Retry logic — one retry after 600ms on network failure.
   *        Exchange codes are single-use; retry only fires on network
   *        errors (TypeError / AbortError), not on 4xx server responses
   *        (those would just fail again with the same expired/invalid code).
   *
   * FIX-3: AbortController timeout (15s). Prevents indefinite hang on 2G.
   *        The server TTL is 60s so 15s still leaves margin.
   *
   * @param  {object} data     - JSON body of a successful login response
   * @param  {string} apiBase  - e.g. window.API_BASE or ''
   * @param  {number} [_retry] - internal retry counter (don't pass externally)
   * @returns {Promise<string>} - JWT string, or '' if failed
   * ──────────────────────────────────────────────────────────────────── */
  async function redeemMobileCode(data, apiBase, _retry) {
    if (!data || !data.mobile_code) {
      // Server didn't send mobile_code — this is a server-side config issue.
      console.error('[AqAuth] redeemMobileCode: no mobile_code in login response. '
        + 'Check authController.js login() — it should always include mobile_code.');
      return '';
    }

    _retry = _retry || 0;

    try {
      var url = (apiBase || '') + '/api/v1/auth/mobile-token/' + data.mobile_code;

      // FIX-3: AbortController timeout (15s) — prevents indefinite hang on 2G
      var controller = new AbortController();
      var timeoutId  = setTimeout(function() { controller.abort(); }, 15000);

      var tr;
      try {
        tr = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!tr.ok) {
        // FIX-1: Log server-side rejection with status code
        console.error('[AqAuth] redeemMobileCode: server rejected code —',
          tr.status, tr.statusText,
          '| Possible causes: multi-instance server (code on different node), '
          + 'code expired (>60s), or code already redeemed.');
        return '';
      }

      var td = await tr.json();
      if (!td || !td.token) {
        console.error('[AqAuth] redeemMobileCode: response OK but no token field.',
          'Response:', JSON.stringify(td));
        return '';
      }

      // Persist Bearer fallback for all subsequent page loads
      try { localStorage.setItem('aq_mobile_token', td.token); } catch (e) {
        // FIX-1: Log storage failures — critical for WebView diagnosis
        console.error('[AqAuth] redeemMobileCode: localStorage.setItem failed:', e,
          '| If this is Flutter WebView, ensure domStorageEnabled: true in WebView config.');
      }
      try { sessionStorage.setItem('aq_mobile_token_mirror', td.token); } catch (e) {
        console.warn('[AqAuth] redeemMobileCode: sessionStorage.setItem failed:', e);
      }

      console.info('[AqAuth] redeemMobileCode: token stored successfully ✓');
      return td.token;

    } catch (err) {
      var isNetworkErr = err.name === 'TypeError' || err.name === 'AbortError';

      // FIX-2: Retry once on network errors only (not 4xx — those won't change)
      // Single-use codes: retry is safe because if the first request failed
      // at network level, the server never processed it and the code is intact.
      if (isNetworkErr && _retry < 1) {
        console.warn('[AqAuth] redeemMobileCode: network error, retrying in 600ms —', err.message);
        await new Promise(function(r) { setTimeout(r, 600); });
        return redeemMobileCode(data, apiBase, _retry + 1);
      }

      // FIX-1: Log the actual failure reason
      console.error('[AqAuth] redeemMobileCode: FAILED —', err.name, err.message,
        '| retry count:', _retry,
        '| This will cause "mobile setup failed" error on login.');
      return '';
    }
  }

  /* ── buildRedirectUrl ──────────────────────────────────────────────────
   * Appends #aqt= for ANY mobile client (touch-primary device).
   * network.js _mobileAuthHeaders() reads the hash on dashboard load,
   * extracts the token, stores it, then strips the hash.
   * ──────────────────────────────────────────────────────────────────── */
  function buildRedirectUrl(base, token) {
    if (token && _isMobileClient) {
      return base + '#aqt=' + encodeURIComponent(token);
    }
    return base;
  }

  /* ── clearMobileAuth ───────────────────────────────────────────────────
   * Remove all Bearer fallback state on logout.
   * FIX-3: Now clears ALL keys consistently.
   * ──────────────────────────────────────────────────────────────────── */
  function clearMobileAuth() {
    try { localStorage.removeItem('aq_mobile_token'); }   catch (_) {}
    try { sessionStorage.removeItem('aq_mobile_token_mirror'); } catch (_) {}
  }

  /* ── Public API ─────────────────────────────────────────────────────── */
  var _api = {
    isMobileClient:   _isMobileClient,
    isWebView:        _isMobileClient, // back-compat alias
    redeemMobileCode: redeemMobileCode,
    buildRedirectUrl: buildRedirectUrl,
    clearMobileAuth:  clearMobileAuth,
  };

  window.AqAuth = _api;
  return _api;

})();
