/**
 * frontend/js/auth-utils.js
 * FIXED VERSION
 */

var AqAuth = window.AqAuth = (function () {
  'use strict';

  /* ──────────────────────────────────────────────────────────────
   * Mobile Detection
   * ────────────────────────────────────────────────────────────── */
  var _isMobileClient = (function () {
    var ua = navigator.userAgent || '';

    if (/wv\)/.test(ua) && /Android/.test(ua)) return true;
    if (/Android/.test(ua) && !/Chrome/.test(ua)) return true;

    try {
      if (
        window.matchMedia &&
        window.matchMedia('(pointer: coarse)').matches
      ) {
        return true;
      }
    } catch (_) {}

    if (window.screen && window.screen.width <= 768) return true;

    return false;
  })();

  /* ──────────────────────────────────────────────────────────────
   * Startup Diagnostics
   * ────────────────────────────────────────────────────────────── */
  (function () {
    var _lsOk = (function () {
      try {
        localStorage.setItem('_aqt', '1');
        localStorage.removeItem('_aqt');
        return true;
      } catch (_) {
        return false;
      }
    })();

    var _ssOk = (function () {
      try {
        sessionStorage.setItem('_aqt', '1');
        sessionStorage.removeItem('_aqt');
        return true;
      } catch (_) {
        return false;
      }
    })();

    var _ua = (navigator.userAgent || '').slice(0, 80);

    console.log(
      '[AqAuth] init — isMobileClient:',
      _isMobileClient,
      'localStorage:',
      _lsOk,
      'sessionStorage:',
      _ssOk,
      'ua:',
      _ua
    );
  })();

  /* ──────────────────────────────────────────────────────────────
   * FIX: Hydrate session mirror from localStorage
   * Prevents redirect auth loss
   * ────────────────────────────────────────────────────────────── */
  (function hydrateAuthMirror() {
    try {
      var lsToken = localStorage.getItem('aq_mobile_token');

      if (lsToken) {
        sessionStorage.setItem('aq_token_mirror', lsToken);

        console.log(
          '[AqAuth] hydrated session mirror from localStorage'
        );
      }
    } catch (e) {
      console.warn('[AqAuth] hydration failed', e);
    }
  })();

  /* ──────────────────────────────────────────────────────────────
   * Redeem Mobile Code
   * ────────────────────────────────────────────────────────────── */
  async function redeemMobileCode(data, apiBase) {

    if (!data || !data.mobile_code) return '';

    var url =
      (apiBase || '') +
      '/api/v1/auth/mobile-token/' +
      data.mobile_code;

    var MAX_TRIES = 2;
    var TIMEOUT = 5000;

    for (var attempt = 0; attempt < MAX_TRIES; attempt++) {

      if (attempt > 0) {
        await new Promise(function (r) {
          setTimeout(r, 500);
        });
      }

      var controller =
        typeof AbortController !== 'undefined'
          ? new AbortController()
          : null;

      var tid = controller
        ? setTimeout(function () {
            controller.abort();
          }, TIMEOUT)
        : null;

      try {

        var tr = await fetch(
          url,
          controller ? { signal: controller.signal } : {}
        );

        if (tid) clearTimeout(tid);

        console.log(
          '[AqAuth] redeemMobileCode attempt',
          attempt + 1,
          '— status:',
          tr.status,
          'ok:',
          tr.ok
        );

        if (tr.status === 401) {
          console.warn(
            '[AqAuth] redeemMobileCode: 401 expired/already redeemed'
          );
          return '';
        }

        if (!tr.ok) {
          console.warn(
            '[AqAuth] redeemMobileCode: HTTP',
            tr.status
          );
          continue;
        }

        var td;

        try {
          td = await tr.json();
        } catch (jsonErr) {
          console.warn(
            '[AqAuth] redeemMobileCode: invalid JSON',
            jsonErr.message
          );
          continue;
        }

        if (!td || !td.token) {
          console.warn(
            '[AqAuth] redeemMobileCode: missing token field'
          );
          return '';
        }

        /* ──────────────────────────────────────────────
         * FIXED TOKEN STORAGE
         * ────────────────────────────────────────────── */

        try {
          localStorage.setItem(
            'aq_mobile_token',
            td.token
          );
        } catch (_) {}

        try {
          sessionStorage.setItem(
            'aq_token_mirror',
            td.token
          );
        } catch (_) {}

        console.log(
          '[AqAuth] redeemMobileCode success'
        );

        return td.token;

      } catch (err) {

        if (tid) clearTimeout(tid);

        var isTimeout =
          err && err.name === 'AbortError';

        console.warn(
          '[AqAuth] redeemMobileCode:',
          isTimeout ? 'TIMEOUT' : 'network error',
          err && err.message
        );
      }
    }

    console.warn(
      '[AqAuth] redeemMobileCode failed completely'
    );

    return '';
  }

  /* ──────────────────────────────────────────────────────────────
   * Build Redirect URL
   * ────────────────────────────────────────────────────────────── */
  function buildRedirectUrl(base, token) {

    if (token && _isMobileClient) {
      return (
        base +
        '#aqt=' +
        encodeURIComponent(token)
      );
    }

    return base;
  }

  /* ──────────────────────────────────────────────────────────────
   * Clear Mobile Auth
   * ────────────────────────────────────────────────────────────── */
  function clearMobileAuth() {

    try {
      localStorage.removeItem('aq_mobile_token');
    } catch (_) {}

    try {
      sessionStorage.removeItem('aq_token_mirror');
    } catch (_) {}
  }

  /* ──────────────────────────────────────────────────────────────
   * Public API
   * ────────────────────────────────────────────────────────────── */
  var _api = {
    isMobileClient: _isMobileClient,
    isWebView: _isMobileClient,

    redeemMobileCode: redeemMobileCode,
    buildRedirectUrl: buildRedirectUrl,
    clearMobileAuth: clearMobileAuth,
  };

  window.AqAuth = _api;

  return _api;

})();
