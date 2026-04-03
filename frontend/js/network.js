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

  const API_BASE = 'https://aqualance-production.up.railway.app';

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

  // ✅ FIX (Login Loop): Helper to wipe ALL portal user keys from sessionStorage.
  // Called before every redirect-to-login so the login page never sees a stale
  // user object and bounces back to the dashboard (the infinite loop root cause).
  function _clearPortalSession() {
    try {
      sessionStorage.removeItem('aq_admin_user');
      sessionStorage.removeItem('aq_sales_user');
      sessionStorage.removeItem('aq_delivery_user');
    } catch (_) {}
  }

  function _runAuthGate() {
    var path = window.location.pathname;

    // Detect if we are in a domain-specific module
    var portalMatches = path.match(/^\/(admin|salesman|delivery)/);
    var portalPrefix = portalMatches ? '/' + portalMatches[1] : '';

    // If it is a public customer page (no portal) or a login/password page, skip auth gate
    if (!portalPrefix || /login|change-password/.test(path)) {
      _authGateResolve(null);
      return;
    }

    // Hide page content until auth is confirmed — prevents flash and
    // avoids any navigation firing without user interaction
    document.documentElement.style.visibility = 'hidden';

    window._aqRehydrating = true;
    fetch(${API_BASE}/api/v1/auth/me, { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) {
          window._aqRehydrating = false;
          document.documentElement.style.visibility = '';
          // ✅ FIX (Login Loop): MUST clear sessionStorage before redirecting.
          // Without this, the login page finds aq_sales_user / aq_delivery_user
          // still set and immediately redirects back to the dashboard → loop.
          _clearPortalSession();
          window.location.replace(portalPrefix + '/login.html');
          return;
        }
        return res.json();
      })
      .then(function(data) {
        if (!data) return;
        var role = data.user && data.user.role;
        // ✅ FIX: Clear ALL role keys first, then only store the current role.
        // Prevents cross-role contamination on shared mobile devices.
        _clearPortalSession();
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
        document.documentElement.style.visibility = '';
        // ✅ FIX (Login Loop): Also clear on network error so the login page
        // does not bounce back to dashboard when the cookie fetch fails.
        _clearPortalSession();
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
      NetBanner.updateNetworkBadge();
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

    // Prepend backend URL for relative paths
    if (typeof url === 'string' && url.startsWith('/')) {
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
     3. OFFLINE BANNER + SLOW NETWORK BANNER
  ══════════════════════════════════════════════════════════════ */
  var NetBanner = {
    _offlineBanner: null,
    _slowBanner:    null,
    _badge:         null,

    init: function () {
      var ob = document.createElement('div');
      ob.id        = 'aq-offline-banner';
      ob.className = 'aq-net-banner aq-offline hidden';
      ob.innerHTML = '<span>📶 No internet connection — working offline</span>' +
                     '<button onclick="NetBanner.retry()">Retry</button>';
      document.body.appendChild(ob);
      NetBanner._offlineBanner = ob;

      var sb = document.createElement('div');
      sb.id        = 'aq-slow-banner';
      sb.className = 'aq-net-banner aq-slow hidden';
      sb.innerHTML = '<span>🐢 Slow connection detected — loading may take longer</span>' +
                     '<button onclick="NetBanner.dismissSlow()">OK</button>';
      document.body.appendChild(sb);
      NetBanner._slowBanner = sb;

      var badge = document.createElement('div');
      badge.id        = 'aq-net-badge';
      badge.className = 'aq-net-badge hidden';
      var topnav = document.querySelector('.topnav');
      if (topnav) {
        badge.style.position   = 'relative';
        badge.style.top        = 'auto';
        badge.style.right      = 'auto';
        badge.style.bottom     = 'auto';
        badge.style.left       = 'auto';
        badge.style.marginLeft = 'auto';
        badge.style.flexShrink = '0';
        topnav.appendChild(badge);
      } else {
        document.body.appendChild(badge);
      }
      NetBanner._badge = badge;

      window.addEventListener('offline', function () {
        ob.classList.remove('hidden');
        ob.classList.add('show');
      });
      window.addEventListener('online', function () {
        ob.classList.remove('show');
        setTimeout(function () { ob.classList.add('hidden'); }, 600);
        _flushQueue();
        NetBanner.updateNetworkBadge();
      });

      if (!navigator.onLine) {
        ob.classList.remove('hidden');
        ob.classList.add('show');
      }

      setTimeout(function () {
        if (NetQ.isSlow() && !sessionStorage.getItem('aq_slow_dismissed')) {
          sb.classList.remove('hidden');
          sb.classList.add('show');
        }
      }, 3000);

      NetBanner.updateNetworkBadge();
    },

    retry: function () {
      if (navigator.onLine) {
        NetBanner._offlineBanner.classList.remove('show');
        setTimeout(function () { NetBanner._offlineBanner.classList.add('hidden'); }, 600);
        _flushQueue();
        var reloaders = [
          'loadProducts', 'loadDashboard', 'loadOrders',
          'loadMyOrders', 'loadLeads', 'loadQuickStats',
          'loadDeliveryBoys', 'loadSalesmen', 'loadLeaderboard',
          'loadMyAreas', 'retryLoadProducts'
        ];
        reloaders.forEach(function(fn) {
          if (typeof window[fn] === 'function') {
            try { window[fn](); } catch(e) {}
          }
        });
      }
    },

    dismissSlow: function () {
      sessionStorage.setItem('aq_slow_dismissed', '1');
      NetBanner._slowBanner.classList.remove('show');
      setTimeout(function () { NetBanner._slowBanner.classList.add('hidden'); }, 600);
    },

    updateNetworkBadge: function () {
      var b = NetBanner._badge;
      if (!b) return;

      if (!navigator.onLine) {
        b.textContent = '✗ Offline';
        b.className   = 'aq-net-badge show tier-offline';
        return;
      }

      var tier  = NetQ.tier;
      var label = { '2g': '2G', '3g': '3G', '4g': '4G', '5g': '5G', 'unknown': '?' }[tier] || '?';
      var cls   = 'aq-net-badge show tier-' + tier;

      if (NetQ.rtt !== null && NetQ.rtt > 0) {
        label += ' · ' + NetQ.rtt + 'ms';
      }

      b.textContent = '📶 ' + label;
      b.className   = cls;

      if (tier === '4g' || tier === '5g' || tier === 'unknown') {
        clearTimeout(NetBanner._badgeTimer);
        NetBanner._badgeTimer = setTimeout(function () {
          b.classList.remove('show');
        }, 5000);
      }
    }
  };

  /* ══════════════════════════════════════════════════════════════
     4. IMAGE OPTIMISATION FOR SLOW CONNECTIONS
  ══════════════════════════════════════════════════════════════ */
  function optimiseImages() {
    if (!NetQ.isSlow()) return;

    document.querySelectorAll('img:not([loading])').forEach(function (img) {
      img.setAttribute('loading', 'lazy');
    });

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
     5. PAGE-LOAD PROGRESS BAR
  ══════════════════════════════════════════════════════════════ */
  var Progress = {
    _bar: null,
    _val: 0,
    _tid: null,

    init: function () {
      var bar = document.createElement('div');
      bar.id = 'aq-progress-bar';
      bar.className = 'aq-progress-bar';
      bar.innerHTML = '<div class="aq-progress-fill" id="aq-progress-fill"></div>';
      if (document.body.firstChild) {
        document.body.insertBefore(bar, document.body.firstChild);
      } else {
        document.body.appendChild(bar);
      }
      Progress._bar = document.getElementById('aq-progress-fill');
    },

    start: function () {
      Progress._val = 5;
      Progress._update();
      clearInterval(Progress._tid);
      Progress._tid = setInterval(function () {
        if (Progress._val < 85) {
          Progress._val += (85 - Progress._val) * 0.08;
          Progress._update();
        }
      }, 200);
    },

    done: function () {
      clearInterval(Progress._tid);
      Progress._val = 100;
      Progress._update();
      setTimeout(function () {
        Progress._val = 0;
        Progress._update();
      }, 400);
    },

    error: function () {
      clearInterval(Progress._tid);
      if (Progress._bar) {
        Progress._bar.style.background = 'var(--danger, #e53e3e)';
        Progress._val = 100;
        Progress._update();
        setTimeout(function () {
          Progress._val = 0;
          Progress._update();
          if (Progress._bar) Progress._bar.style.background = '';
        }, 800);
      }
    },

    _update: function () {
      if (Progress._bar) {
        Progress._bar.style.width = Progress._val + '%';
      }
    }
  };

  /* ══════════════════════════════════════════════════════════════
     6. PATCH apiFetch ON EVERY PAGE
  ══════════════════════════════════════════════════════════════ */
  var _apiFetchPatched = false;

  function patchApiFetch() {
    if (typeof window.apiFetch !== 'function') return;
    if (_apiFetchPatched) return;
    _apiFetchPatched = true;

    window.apiFetch = (function(orig) {
      return function (url, options) {
        options = options || {};
        Progress.start();

        return global._aqAuthReady.then(function() {
          var adaptedOpts = Object.assign({}, options, { _timeout: NetQ.timeout() });

          return adaptiveFetch(url, Object.assign({
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' }
          }, adaptedOpts))
          .then(function (res) {
            Progress.done();

            if (res.status === 401 || res.status === 403) {
              if (window._aqRehydrating) {
                throw new Error('Session expired. Please log in again.');
              }
              // ✅ FIX: Clear sessionStorage on forced logout too
              _clearPortalSession();
              if (typeof window.adminLogout === 'function') {
                window.adminLogout();
              } else if (typeof window.salesLogout === 'function') {
                window.salesLogout();
              } else if (typeof window.deliveryLogout === 'function') {
                window.deliveryLogout();
              } else {
                var portalMatches = window.location.pathname.match(/^\/(admin|salesman|delivery)/);
                var portalPrefix = portalMatches ? '/' + portalMatches[1] : '';
                window.location.replace(portalPrefix + '/login.html');
              }
              throw new Error('Session expired. Please log in again.');
            }

            return res;
          })
          .catch(function (err) {
            Progress.error();
            if (err.name === 'AbortError') {
              var tierMsg = { '2g': 'Your 2G connection is very slow', '3g': 'Your 3G connection timed out' }[NetQ.tier] || 'Connection timed out';
              throw new Error(tierMsg + ' — please retry.');
            }
            throw err;
          });
        });
      };
    })(window.apiFetch);
  }

  /* ══════════════════════════════════════════════════════════════
     7. STALE DATA CACHE (sessionStorage)
  ══════════════════════════════════════════════════════════════ */
  var DataCache = {
    set: function (key, data) {
      try {
        sessionStorage.setItem('aq_cache_' + key, JSON.stringify({
          data: data,
          ts: Date.now()
        }));
      } catch (e) {}
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

  /* Patch native window.fetch so every portal benefits without touching call sites */
  const _nativeFetch = window.fetch.bind(window);
  window.fetch = function(url, options) {
    if (typeof url === 'string' && url.startsWith('/api')) {
      url = API_BASE + url;
    }
    return _nativeFetch(url, options);
  };

  /* ══════════════════════════════════════════════════════════════
     INIT — run when DOM is ready
  ══════════════════════════════════════════════════════════════ */
  function init() {
    NetQ.detect();
    NetBanner.init();
    Prog
