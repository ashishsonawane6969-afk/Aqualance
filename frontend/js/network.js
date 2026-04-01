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
    fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' })
      .then(function(res) {
        if (!res.ok) {
          window._aqRehydrating = false;
          // Use a user-initiated-style navigation via clicking a hidden anchor
          // so Chrome does not flag it as a non-interaction history entry
          // Use an absolute redirect to the correct portal login
          var a = document.createElement('a');
          a.href = portalPrefix + '/login.html';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          return;
        }
        return res.json();
      })
      .then(function(data) {
        if (!data) return;
        var role = data.user && data.user.role;
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
        var a = document.createElement('a');
        a.href = portalPrefix + '/login.html';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
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
      fetch('/favicon.ico?_nq=' + t0, { method: 'HEAD', cache: 'no-store', mode: 'no-cors' })
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
     3. OFFLINE BANNER + SLOW NETWORK BANNER
  ══════════════════════════════════════════════════════════════ */
  var NetBanner = {
    _offlineBanner: null,
    _slowBanner:    null,
    _badge:         null,

    init: function () {
      // Offline banner
      var ob = document.createElement('div');
      ob.id        = 'aq-offline-banner';
      ob.className = 'aq-net-banner aq-offline hidden';
      ob.innerHTML = '<span>📶 No internet connection — working offline</span>' +
                     '<button onclick="NetBanner.retry()">Retry</button>';
      document.body.appendChild(ob);
      NetBanner._offlineBanner = ob;

      // Slow-network banner
      var sb = document.createElement('div');
      sb.id        = 'aq-slow-banner';
      sb.className = 'aq-net-banner aq-slow hidden';
      sb.innerHTML = '<span>🐢 Slow connection detected — loading may take longer</span>' +
                     '<button onclick="NetBanner.dismissSlow()">OK</button>';
      document.body.appendChild(sb);
      NetBanner._slowBanner = sb;

      // Network badge — appended to topnav on desktop so it never overflows,
      // falls back to fixed positioning on pages without a topnav.
      var badge = document.createElement('div');
      badge.id        = 'aq-net-badge';
      badge.className = 'aq-net-badge hidden';
      var topnav = document.querySelector('.topnav');
      if (topnav) {
        // Sit inside the topnav at the far right
        badge.style.position = 'relative';
        badge.style.top      = 'auto';
        badge.style.right    = 'auto';
        badge.style.bottom   = 'auto';
        badge.style.left     = 'auto';
        badge.style.marginLeft = 'auto';
        badge.style.flexShrink = '0';
        topnav.appendChild(badge);
      } else {
        document.body.appendChild(badge);
      }
      NetBanner._badge = badge;

      // Online / offline events
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

      // Show slow banner once per session
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
        // Trigger the appropriate page reload function
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

      // Add RTT if we have it
      if (NetQ.rtt !== null && NetQ.rtt > 0) {
        label += ' · ' + NetQ.rtt + 'ms';
      }

      b.textContent = '📶 ' + label;
      b.className   = cls;

      // Auto-hide badge after 5s (unless on 2G/3G — keep it visible as a reminder)
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
     5. PAGE-LOAD PROGRESS BAR
     Thin bar at the top — shows loading activity on slow networks
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
          // Slow increment — faster at start, slower as it approaches completion
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
          headers: { 'Content-Type': 'application/json' }
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
              try { sessionStorage.clear(); } catch (_) {}
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

  /* ══════════════════════════════════════════════════════════════
     INIT — run when DOM is ready
  ══════════════════════════════════════════════════════════════ */
  function init() {
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
        // Silently re-validate the cookie without hiding the page.
        // If the cookie expired while the tab was inactive, the next
        // apiFetch will return 401 and logout() will handle the redirect.
        fetch(`${API_BASE}/api/v1/auth/me`, { credentials: 'include' })
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