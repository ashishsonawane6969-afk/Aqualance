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

  // COUNCIL FIX: capture native fetch NOW, before network.js patch overwrites window.fetch.
  // redeemMobileCode MUST use native fetch — the patched version can inject stale
  // Authorization headers on retry attempts, causing the exchange endpoint to reject
  // the request (it expects NO auth header — the code itself is the credential).
  var _nativeFetch = window.fetch ? window.fetch.bind(window) : null;

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

  // FIX: startup hydration — mirror localStorage token into sessionStorage
  // so _runAuthGate POST-DELAY finds ss_mirror:true even on fresh page load.
  (function hydrateAuthMirror() {
    try {
      var lsToken = localStorage.getItem('aq_mobile_token');
      if (lsToken) {
        sessionStorage.setItem('aq_token_mirror', lsToken);
        console.log('[AqAuth] hydrated session mirror');
      }
    } catch (e) {
      console.warn('[AqAuth] hydration failed', e);
    }
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
    // COUNCIL FIX — four changes:
    // 1. Uses _nativeFetch (captured before network.js patch) — eliminates
    //    stale-token Authorization header injection on retries.
    // 2. data.token direct fallback — if server embeds token in login response,
    //    skip the exchange entirely (no second round-trip to fail).
    // 3. Extended timeout 15s (was 5s) — WebView on Windows has higher network
    //    overhead than mobile Chrome; 5s hit TimeoutError silently.
    // 4. Full diagnostic logging at every exit point.

    var fetchFn = _nativeFetch || window.fetch.bind(window);

    // ── FAST PATH: server embedded token directly in login response ──────
    // Some server builds return data.token instead of (or alongside) mobile_code.
    // Using it directly eliminates the exchange round-trip entirely.
    if (data && data.token) {
      console.log('[AqAuth] redeemMobileCode: direct token in response — skipping exchange');
      try { localStorage.setItem('aq_mobile_token', data.token); } catch (_) {}
      try { sessionStorage.setItem('aq_token_mirror', data.token); } catch (_) {}
      return data.token;
    }

    // ── Diagnostic: log what the login response contains ─────────────────
    console.log('[AqAuth] redeemMobileCode — data keys:', Object.keys(data || {}).join(','),
      'has mobile_code:', !!(data && data.mobile_code),
      'apiBase:', apiBase || '(empty)');

    if (!data || !data.mobile_code) {
      console.warn('[AqAuth] redeemMobileCode: no mobile_code in login response — cannot exchange.');
      return '';
    }

    var url      = (apiBase || '') + '/api/v1/auth/mobile-token/' + data.mobile_code;
    var MAX_TRIES = 3;      // two retries
    var TIMEOUT   = 15000;  // 15s — WebView Windows has higher network overhead

    console.log('[AqAuth] redeemMobileCode — exchange url:', url);

    for (var attempt = 0; attempt < MAX_TRIES; attempt++) {
      if (attempt > 0) {
        await new Promise(function(r) { setTimeout(r, 600 * attempt); });
      }

      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var tid = controller ? setTimeout(function() { controller.abort(); }, TIMEOUT) : null;

      try {
        // Use NATIVE fetch — no Authorization header injection from network.js patch.
        // The mobile_code IS the credential; adding Bearer headers breaks the endpoint.
        var tr = await fetchFn(url, controller ? { signal: controller.signal } : {});
        if (tid) clearTimeout(tid);

        console.log('[AqAuth] redeemMobileCode attempt', attempt + 1,
          '— status:', tr.status, 'ok:', tr.ok, 'url:', url.slice(-30));

        if (tr.status === 401) {
          console.warn('[AqAuth] redeemMobileCode: 401 — code expired or already redeemed.');
          return '';
        }
        if (!tr.ok) {
          console.warn('[AqAuth] redeemMobileCode: HTTP', tr.status, '— attempt', attempt + 1);
          continue;
        }

        var td;
        try { td = await tr.json(); }
        catch (jsonErr) {
          console.warn('[AqAuth] redeemMobileCode: invalid JSON —', jsonErr.message);
          continue;
        }

        console.log('[AqAuth] redeemMobileCode: response keys:', Object.keys(td || {}).join(','));

        if (!td || !td.token) {
          console.warn('[AqAuth] redeemMobileCode: ok but no token field in response');
          return '';
        }

        try { localStorage.setItem('aq_mobile_token', td.token); } catch (_) {}
        try { sessionStorage.setItem('aq_token_mirror', td.token); } catch (_) {}

        console.log('[AqAuth] redeemMobileCode: SUCCESS attempt', attempt + 1);
        return td.token;

      } catch (err) {
        if (tid) clearTimeout(tid);
        var isTimeout = err && err.name === 'AbortError';
        console.warn('[AqAuth] redeemMobileCode:', isTimeout ? 'TIMEOUT' : 'NETWORK ERROR',
          '— attempt', attempt + 1, '—', err && err.message);
      }
    }

    console.warn('[AqAuth] redeemMobileCode: ALL ATTEMPTS FAILED — cookie auth is only fallback');
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
    // FIX: removed _isMobileClient gate.
    // Hash handoff now fires for ANY client when a bearer token is available.
    // Reason: web wrapper apps (Flutter/WebView on Windows/desktop) report
    // isMobileClient:false (desktop UA) yet localStorage does NOT persist
    // reliably across page navigations inside the WebView context.
    // The #aqt= hash is part of the URL itself — survives location.replace()
    // in every environment. network.js reads it, writes to localStorage +
    // sessionStorage, then strips it. Zero user-visible effect on real desktop.
    if (token) {
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
    try { sessionStorage.removeItem('aq_token_mirror'); } catch (_) {}
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
