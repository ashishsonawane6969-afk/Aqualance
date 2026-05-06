/**
 * network.js — Aqualence Ventures
 * ─────────────────────────────────────────────────────────────────
 * Universal network adaptation layer.
 * Supports all bands: 2G (EDGE/GPRS) · 3G (HSPA) · 4G (LTE) · 5G (NR)
 *
 * Features:
 *   1. Network quality detection (via Network Information API + RTT probing)
 *   2. Adaptive fetch — auto-adjusts timeouts based on connection speed
 *   3. Exponential backoff retry with jitter
 *   4. Offline banner + auto-reconnect
 *   5. Slow-network warning banner
 *   6. Request queue — holds requests while offline, flushes on reconnect
 *   7. Image lazy-loading + low-quality swap on slow connections
 *   8. Saves last known data to sessionStorage as a fallback
 * ─────────────────────────────────────────────────────────────────
 */
console.log("✅ NEW network.js LOADED");


(function (global) {
  'use strict';

  const API_BASE = (function() {
    // Allow override via window.API_BASE or meta tag
    const meta = document.querySelector('meta[name="api-base"]');
    return window.API_BASE || (meta && meta.content) || '';
  })();

  // Helper: build headers for /auth/me and other direct fetch() calls.
  // On mobile, cross-site cookies are blocked so we fall back to Bearer token
  // stored in localStorage after login.
  function _mobileAuthHeaders() {
    return { 'Content-Type': 'application/json' };
  }

  // Helper: clear ALL auth state (sessionStorage + localStorage)
  function _clearAuthState() {
    try {
      sessionStorage.removeItem('aq_admin_user');
      sessionStorage.removeItem('aq_sales_user');
      sessionStorage.removeItem('aq_delivery_user');
      sessionStorage.removeItem('aq_admin_user');
    } catch (_) {}
  }
  /* ══════════════════════════════════════════════════════════════
     0. GLOBAL AUTH GATE
     Fires /auth/me once per page load. All apiFetch calls are
     queued until this resolves. On failure → redirect to login.
     Pages never need to call rehydrate themselves.
  ══════════════════════════════════════════════════════════════ */
  var _authGateResolve;
  var _authGateReject;
  // Exposed globally so individual rehydrate functions can also resolve it
  global._aqAuthReady = new Promise(function(res, rej) {
    _authGateResolve = res;
    _authGateReject  = rej;
  });

  function _runAuthGate() {
    var path = window.location.pathname;

    // Detect if we are in a domain-specific module
    var portalMatches = path.match(/^\/(admin|salesman|delivery)/);
    var portalPrefix = portalMatches ? '/' + portalMatches[1] : '';

    // If it is a public customer page (no portal), skip auth gate
    // ✅ FIX (Login Loop): For login/change-password pages, we still run /auth/me
    // to check if the cookie is already valid. If it is, redirect to dashboard
    // immediately — this replaces the removed sessionStorage-based redirect that
    // caused the loop. If it is not valid, simply resolve and let the page render.
    if (!portalPrefix) {
      _authGateResolve(null);
      return;
    }

    var isLoginPage        = /login/.test(path) && !/change-password/.test(path);
    var isChangePassPage   = /change-password/.test(path);

    // change-password: always show the form — never redirect to dashboard.
    // The user may have a valid session but still need to set a new password.
    if (isChangePassPage) {
      _authGateResolve(null);
      return;
    }

    if (isLoginPage) {
      fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include', headers: _mobileAuthHeaders() })
        .then(function(res) {
          if (res.ok) {
            return res.json().then(function(data) {
              if (data && data.user) {
                // Cookie is valid — go straight to dashboard, skip login form
                window.location.replace(portalPrefix + '/dashboard.html');
                return;
              }
              _authGateResolve(null);
            });
          } else {
            // Session invalid/expired — clear any stale auth state and show login
            _clearAuthState();
            _authGateResolve(null);
          }
        })
        .catch(function() {
          // Offline or network error — just show the login form
          _authGateResolve(null);
        });
      return;
    }

    // Hide page content until auth is confirmed — prevents flash and
    // avoids any navigation firing without user interaction
    document.documentElement.style.visibility = 'hidden';

    window._aqRehydrating = true;
    fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include', headers: _mobileAuthHeaders() })
      .then(function(res) {
        if (!res.ok) {
          window._aqRehydrating = false;
          _clearAuthState();
          window.location.replace(portalPrefix + '/login.html');
          return;
        }
        return res.json();
      })
      .then(function(data) {
        if (!data) return;
        var role = data.user && data.user.role;

        // Role ↔ portal mismatch: user is authenticated but wrong portal
        // e.g. delivery boy visiting /admin/ — redirect to their own portal
        var expectedRole = portalPrefix.replace('/', ''); // 'admin' | 'salesman' | 'delivery'
        if (role !== expectedRole) {
          window._aqRehydrating = false;
          _clearAuthState();
          window.location.replace('/' + role + '/login.html');
          return;
        }

        if (role === 'admin') {
          sessionStorage.setItem('aq_admin_user', JSON.stringify(data.user));
        } else if (role === 'salesman') {
          sessionStorage.setItem('aq_sales_user', JSON.stringify(data.user));
        } else if (role === 'delivery') {
          sessionStorage.setItem('aq_delivery_user', JSON.stringify(data.user));
        }
        window._aqRehydrating = false;
        // Reveal page now that auth is confirmed
        document.documentElement.style.visibility = '';
        _authGateResolve(data.user);
      })
      .catch(function() {
        window._aqRehydrating = false;
        // Keep page hidden until redirect completes — avoids content flash
        _clearAuthState();
        window.location.replace(portalPrefix + '/login.html');
      });
  }

  /* ══════════════════════════════════════════════════════════════
     1. NETWORK QUALITY DETECTION
     Detects: 2G / 3G / 4G / 5G / unknown
     Sources: Navigator.connection (Network Information API) + RTT probe
  ══════════════════════════════════════════════════════════════ */
  var NetQ = {
    tier: 'unknown',   // '2g' | '3g' | '4g' | '5g' | 'unknown'
    rtt:  null,        // estimated round-trip time in ms
    downlink: null,    // estimated downlink in Mbps
    saveData: false,   // user has data-saver on

    detect: function () {
      var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        NetQ.saveData = !!conn.saveData;
        NetQ.rtt      = conn.rtt      || null;
        NetQ.downlink = conn.downlink || null;

        // effectiveType is the most reliable indicator
        var et = (conn.effectiveType || '').toLowerCase();
        if (et === 'slow-2g' || et === '2g')  { NetQ.tier = '2g'; }
        else if (et === '3g')                  { NetQ.tier = '3g'; }
        else if (et === '4g') {
          // Distinguish 4G from 5G by downlink speed (5G NR Sub-6: >100 Mbps)
          NetQ.tier = (NetQ.downlink && NetQ.downlink >= 100) ? '5g' : '4g';
        } else {
          NetQ.tier = 'unknown';
        }

        conn.addEventListener('change', function () { NetQ.detect(); NetQ._notify(); });
      } else {
        // Fallback: probe with a tiny image fetch
        NetQ._probe();
      }
    },

    _probe: function () {
      var t0 = Date.now();
      // Fetch a 1-pixel GIF (cachebust so it always goes to network)
      fetch('/api/v1/health?_nq=' + t0, { method: 'GET', cache: 'no-store', mode: 'no-cors' })
        .then(function () {
          var rtt = Date.now() - t0;
          NetQ.rtt = rtt;
          if (rtt > 2000)      NetQ.tier = '2g';
          else if (rtt > 600)  NetQ.tier = '3g';
          else if (rtt > 100)  NetQ.tier = '4g';
          else                 NetQ.tier = '5g';
          NetQ._notify();
        })
        .catch(function () { NetQ.tier = 'unknown'; });
    },

    /* Returns adaptive timeout in ms based on tier */
    timeout: function () {
      return { '2g': 45000, '3g': 25000, '4g': 12000, '5g': 8000 }[NetQ.tier] || 20000;
    },

    /* Returns max retries based on tier */
    maxRetries: function () {
      return { '2g': 4, '3g': 3, '4g': 2, '5g': 1 }[NetQ.tier] || 3;
    },

    /* Returns whether this is a slow connection */
    isSlow: function () {
      return NetQ.tier === '2g' || NetQ.saveData ||
             (NetQ.rtt !== null && NetQ.rtt > 1500);
    },

    _listeners: [],
    onChange: function (fn) { NetQ._listeners.push(fn); },
    _notify: function () {
      NetQ._listeners.forEach(function (fn) { try { fn(NetQ.tier); } catch (e) {} });
    }
  };

  /* ══════════════════════════════════════════════════════════════
     2. ADAPTIVE FETCH
     Drop-in replacement for fetch() with:
       • auto timeout scaled to network tier
       • exponential backoff retry with jitter
       • offline queue
  ══════════════════════════════════════════════════════════════ */
  var OfflineQueue = [];

  function adaptiveFetch(url, options, _retryCount) {
    options      = options      || {};
    _retryCount  = _retryCount  || 0;

     // ✅ FIX: prepend backend URL
  if (url.startsWith('/')) {
    url = API_BASE + url;
  }
    var maxRetry = NetQ.maxRetries();
    var timeout  = (options._timeout !== undefined) ? options._timeout : NetQ.timeout();

    // If offline, queue the request (GET only — mutations are unsafe to replay)
    if (!navigator.onLine && (options.method || 'GET') === 'GET') {
      return new Promise(function (resolve, reject) {
        OfflineQueue.push({ url: url, options: options, resolve: resolve, reject: reject });
      });
    }

    var controller = new AbortController();
    var tid = setTimeout(function () { controller.abort(); }, timeout);

    // Merge signal (don't override caller's signal if they passed one)
    var fetchOpts = Object.assign({}, options, {
      signal: options.signal || controller.signal
    });
    delete fetchOpts._timeout;

    return fetch(url, fetchOpts)
      .then(function (res) {
        clearTimeout(tid);
        return res;
      })
      .catch(function (err) {
        clearTimeout(tid);

        var isTimeout = err.name === 'AbortError';
        var isNetwork = err.name === 'TypeError' || err.message === 'Failed to fetch';

        if ((isTimeout || isNetwork) && _retryCount < maxRetry) {
          // Exponential backoff: 1s · 2s · 4s · 8s + random jitter (±200ms)
          var delay = Math.pow(2, _retryCount) * 1000 + (Math.random() * 400 - 200);
          return new Promise(function (res) { setTimeout(res, delay); })
            .then(function () { return adaptiveFetch(url, options, _retryCount + 1); });
        }

        throw err;
      });
  }

  /* Flush queue when back online */
  function _flushQueue() {
    var queue = OfflineQueue.splice(0);
    queue.forEach(function (item) {
      adaptiveFetch(item.url, item.options)
        .then(item.resolve)
        .catch(item.reject);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     3. OFFLINE / SLOW BANNERS — REMOVED (no-op stubs)
  ══════════════════════════════════════════════════════════════ */
  var NetBanner = {
    _offlineBanner: null,
    _slowBanner:    null,
    init:           function () {},
    retry:          function () { if (navigator.onLine) _flushQueue(); },
    dismissSlow:    function () {}
  };

  /* ══════════════════════════════════════════════════════════════
     4. IMAGE OPTIMISATION FOR SLOW CONNECTIONS
     On 2G/slow: defers loading off-screen images, reduces quality
  ══════════════════════════════════════════════════════════════ */
  function optimiseImages() {
    if (!NetQ.isSlow()) return;

    // Add loading="lazy" to all images that don't have it
    document.querySelectorAll('img:not([loading])').forEach(function (img) {
      img.setAttribute('loading', 'lazy');
    });

    // Observe future images added to DOM
    if ('MutationObserver' in window) {
      var mo = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
          m.addedNodes.forEach(function (node) {
            if (node.nodeType === 1) {
              node.querySelectorAll && node.querySelectorAll('img:not([loading])').forEach(function (img) {
                img.setAttribute('loading', 'lazy');
              });
            }
          });
        });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  /* ══════════════════════════════════════════════════════════════
     5. PAGE-LOAD PROGRESS BAR — REMOVED (no-op stubs)
  ══════════════════════════════════════════════════════════════ */
  var Progress = {
    _bar: null, _val: 0, _tid: null,
    init:    function () {},
    start:   function () {},
    done:    function () {},
    error:   function () {},
    _update: function () {}
  };

  /* ══════════════════════════════════════════════════════════════
     6. PATCH apiFetch ON EVERY PAGE
     Each page defines its own apiFetch — we wrap it with adaptive behaviour
  ══════════════════════════════════════════════════════════════ */
  var _apiFetchPatched = false;
  // Set window._aqRehydrating = true before calling /auth/me, clear it after.
  // patchApiFetch will skip the 401/403 logout handler during rehydration.
  function patchApiFetch() {
    if (typeof window.apiFetch !== 'function') return;
    if (_apiFetchPatched) return;   // guard: never double-wrap
    _apiFetchPatched = true;

    var orig = window.apiFetch;
    window.apiFetch = function (url, options) {
      options = options || {};
      Progress.start();

      // Wait for auth gate before firing any request — prevents 401 races on page load
      return global._aqAuthReady.then(function() {
        // Build a new options object with adaptive timeout
        var adaptedOpts = Object.assign({}, options, { _timeout: NetQ.timeout() });

        return adaptiveFetch(url, Object.assign({
          credentials: 'include',
          headers: _mobileAuthHeaders()
        }, adaptedOpts))
        .then(function (res) {
          Progress.done();

          // ── Auth guard (Fix: was stripped when network.js replaced apiFetch) ──
          // The original apiFetch in admin.js handled 401/403 by calling adminLogout().
          // This wrapper bypassed that check entirely — re-instating it here so that
          // a 403 Forbidden on PUT /products/:id (or any write) correctly logs out
          // and redirects instead of silently failing in the UI.
          if (res.status === 401 || res.status === 403) {
            // Skip logout during rehydration — the /auth/me call itself may 401
            // if the cookie is genuinely expired, and the rehydrate function handles
            // that redirect itself. Firing logout here too causes a double-redirect race.
            if (window._aqRehydrating) {
              throw new Error('Session expired. Please log in again.');
            }
            if (typeof window.adminLogout === 'function') {
              window.adminLogout();
            } else if (typeof window.salesLogout === 'function') {
              window.salesLogout();
            } else if (typeof window.deliveryLogout === 'function') {
              window.deliveryLogout();
            } else {
              // Generic fallback — navigate to the correct portal login
              var portalMatches = window.location.pathname.match(/^\/(admin|salesman|delivery)/);
              var portalPrefix = portalMatches ? '/' + portalMatches[1] : '';
              try { _clearAuthState(); } catch (_) {}
              window.location.replace(portalPrefix + '/login.html');
            }
            // Throw so downstream .catch() handlers show the right message
            throw new Error('Session expired. Please log in again.');
          }

          return res;
        })
        .catch(function (err) {
          Progress.error();
          // Translate abort errors into friendly messages
          if (err.name === 'AbortError') {
            var tierMsg = { '2g': 'Your 2G connection is very slow', '3g': 'Your 3G connection timed out' }[NetQ.tier] || 'Connection timed out';
            throw new Error(tierMsg + ' — please retry.');
          }
          throw err;
        });
      }); // end _aqAuthReady.then
    };

  }

  /* ══════════════════════════════════════════════════════════════
     7. STALE DATA CACHE (sessionStorage)
     Saves last successful API responses so pages can show
     cached data while offline or during slow retries
  ══════════════════════════════════════════════════════════════ */
  var DataCache = {
    set: function (key, data) {
      try {
        sessionStorage.setItem('aq_cache_' + key, JSON.stringify({
          data: data,
          ts: Date.now()
        }));
      } catch (e) { /* quota exceeded — ignore */ }
    },

    get: function (key, maxAgeMs) {
      try {
        var raw  = sessionStorage.getItem('aq_cache_' + key);
        if (!raw) return null;
        var entry = JSON.parse(raw);
        if (maxAgeMs && (Date.now() - entry.ts) > maxAgeMs) return null;
        return entry.data;
      } catch (e) { return null; }
    }
  };



  // frontend/js/network.js — add this block inside the IIFE, before the init() call
// Patch native window.fetch so every portal benefits without touching 30+ call sites
const _nativeFetch = window.fetch.bind(window);
window.fetch = function(url, options) {
  if (typeof url === 'string' && url.startsWith('/api')) {
    url = API_BASE + url;  // API_BASE = 'https://aqualance-production-9e22.up.railway.app'
  }
  return _nativeFetch(url, options);
};

  

  /* ══════════════════════════════════════════════════════════════
     INIT — run when DOM is ready
  ══════════════════════════════════════════════════════════════ */
  function init() {
    // Inject favicon if not already present — prevents 404 on every page
    if (!document.querySelector('link[rel~="icon"]')) {
      var fav = document.createElement('link');
      fav.rel  = 'icon';
      fav.type = 'image/png';
      fav.href = '/images/icon-192.png';
      document.head.appendChild(fav);
    }

    NetQ.detect();
    NetBanner.init();
    Progress.init();
    optimiseImages();
    patchApiFetch();
    _runAuthGate();

    // Add body class for CSS targeting based on tier
    NetQ.onChange(function (tier) {
      document.body.classList.remove('net-2g', 'net-3g', 'net-4g', 'net-5g');
      if (tier && tier !== 'unknown') {
        document.body.classList.add('net-' + tier);
      }
    });
    // Apply immediately
    document.body.classList.remove('net-2g', 'net-3g', 'net-4g', 'net-5g');
    if (NetQ.tier && NetQ.tier !== 'unknown') {
      document.body.classList.add('net-' + NetQ.tier);
    }

    // Patch apiFetch after a tick in case page defines it late
    setTimeout(patchApiFetch, 100);

    // Re-detect on visibility change (user switches tabs, comes back)
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        NetQ._probe && NetQ._probe();
        // Only re-validate session on portal pages — skip on public customer pages
        var _path = window.location.pathname;
        var _isPortal = /^\/(admin|salesman|delivery)/.test(_path);
        if (!_isPortal) return; // no auth needed on customer storefront
        // Silently re-validate the cookie without hiding the page.
        // If the cookie expired while the tab was inactive, the next
        // apiFetch will return 401 and logout() will handle the redirect.
        fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include', headers: _mobileAuthHeaders() })
          .then(function(res) {
            if (!res.ok) {
              // Cookie expired — log out via the appropriate logout fn
              if (typeof window.adminLogout === 'function') window.adminLogout();
              else if (typeof window.salesLogout === 'function') window.salesLogout();
              else if (typeof window.deliveryLogout === 'function') window.deliveryLogout();
              return;
            }
            return res.json();
          })
          .then(function(data) {
            if (!data) return;
            // Refresh sessionStorage with latest user data
            var role = data.user && data.user.role;
            if (role === 'admin')    sessionStorage.setItem('aq_admin_user',    JSON.stringify(data.user));
            else if (role === 'salesman')  sessionStorage.setItem('aq_sales_user',    JSON.stringify(data.user));
            else if (role === 'delivery')  sessionStorage.setItem('aq_delivery_user', JSON.stringify(data.user));
          })
          .catch(function() { /* network error — stay on page, retry on next action */ });
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ── Public API ─────────────────────────────────────────────── */
  global.AqNet = {
    fetch:     adaptiveFetch,
    quality:   NetQ,
    cache:     DataCache,
    progress:  Progress,
    banner:    NetBanner
  };

}(window));
