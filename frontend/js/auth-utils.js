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

  // FIX-8 [AqAuth] startup diagnostic — logged once on auth-utils.js init.
  // Shows client classification and storage availability for debugging.
  (function() {
    var _lsOk  = (function() { try { localStorage.setItem('_aqt','1'); localStorage.removeItem('_aqt'); return true; } catch(_) { return false; } })();
    var _ssOk  = (function() { try { sessionStorage.setItem('_aqt','1'); sessionStorage.removeItem('_aqt'); return true; } catch(_) { return false; } })();
    var _ua    = (navigator.userAgent || '').slice(0, 80);
    console.log('[AqAuth] init — isMobileClient:', _isMobileClient,
      'localStorage:', _lsOk, 'sessionStorage:', _ssOk,
      'ua:', _ua);
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
    // FIX-3: Add retry (once after 500ms), per-attempt timeout, and structured
    // diagnostics. Original had no retry and silent catch — a single network
    // blip on 2G silently dropped the Bearer token with no recovery path.
    // Now distinguishes: network error vs 401 (expired/redeemed) vs timeout vs
    // bad JSON. Returns '' on failure so callers fall back to cookie auth.
    if (!data || !data.mobile_code) return '';

    var url      = (apiBase || '') + '/api/v1/auth/mobile-token/' + data.mobile_code;
    var MAX_TRIES = 2;     // one retry after initial failure
    var TIMEOUT   = 5000;  // 5s per attempt — prevents hung navigation on 2G

    for (var attempt = 0; attempt < MAX_TRIES; attempt++) {
      if (attempt > 0) {
        // Wait 500ms before retry — gives transient network issues time to clear
        await new Promise(function(r) { setTimeout(r, 500); });
      }

      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var tid = controller ? setTimeout(function() { controller.abort(); }, TIMEOUT) : null;

      try {
        // NOTE: no `credentials: 'include'` — the code IS the credential.
        // Sending credentials causes CORS preflight on some mobile Chrome builds.
        var tr = await fetch(url, controller ? { signal: controller.signal } : {});
        if (tid) clearTimeout(tid);

        // FIX-8 [AqAuth] structured log
        console.log('[AqAuth] redeemMobileCode attempt', attempt + 1,
          '— status:', tr.status, 'ok:', tr.ok,
          'mobile:', !!_isMobileClient, 'url:', url.slice(-20));

        if (tr.status === 401) {
          // 401 = expired or already redeemed — retry won't help (code is gone)
          console.warn('[AqAuth] redeemMobileCode: 401 — code expired or already redeemed. No retry.');
          return '';
        }
        if (!tr.ok) {
          console.warn('[AqAuth] redeemMobileCode: HTTP', tr.status, '— attempt', attempt + 1);
          continue; // retry on 5xx / network errors
        }

        var td;
        try { td = await tr.json(); }
        catch (jsonErr) {
          console.warn('[AqAuth] redeemMobileCode: invalid JSON —', jsonErr.message);
          continue;
        }

        if (!td || !td.token) {
          console.warn('[AqAuth] redeemMobileCode: response ok but no token field');
          return '';
        }

        // Persist for Bearer fallback on all subsequent page loads
        try { localStorage.setItem('aq_mobile_token', td.token); } catch (_) {}
        try { sessionStorage.setItem('aq_mobile_token_mirror', td.token); } catch (_) {}

        console.log('[AqAuth] redeemMobileCode: success on attempt', attempt + 1);
        return td.token;

      } catch (err) {
        if (tid) clearTimeout(tid);
        var isTimeout = err && err.name === 'AbortError';
        console.warn('[AqAuth] redeemMobileCode:', isTimeout ? 'TIMEOUT' : 'network error',
          '— attempt', attempt + 1, '—', err && err.message);
        // Continue to retry on timeout/network error
      }
    }

    console.warn('[AqAuth] redeemMobileCode: all attempts failed — falling back to cookie auth');
    return '';
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
