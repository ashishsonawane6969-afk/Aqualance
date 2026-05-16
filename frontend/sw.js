/**
 * sw.js — Service Worker (PWA / Play Store requirement)
 * ─────────────────────────────────────────────────────────────────────────────
 * Strategy:
 *   • Static assets (CSS, JS, images): Cache-First — fast loads, works offline
 *   • API calls:                        Network-First — always fresh data,
 *                                       falls back to cached if offline
 *   • HTML pages:                       Network-First with offline fallback page
 *
 * This enables:
 *   ✓ PWA install prompt on Android Chrome
 *   ✓ Play Store TWA submission (requires service worker)
 *   ✓ Offline page instead of Chrome's "No Internet" dinosaur
 *   ✓ Fast repeat loads via asset caching
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CACHE_NAME    = 'aqualence-v9';  // bumped: defines SW_API_BASE, fixes ReferenceError crash
const OFFLINE_URL   = '/offline.html';

// SW_API_BASE — backend origin used for cross-origin API rewriting.
// MUST be declared here: Service Workers have no access to window, document,
// or any value injected by the page. This is a plain static site with no build
// step, so there is no bundler to inject env vars — declare it explicitly.
// Keep in sync with API_BASE in network.js / admin.js / salesman.js.
const SW_API_BASE = 'https://aqualance-production-9e22.up.railway.app';

// Static assets to pre-cache on install
// frontend/sw.js
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/customer.css',   // ✅ was '/css/app.css' — file doesn't exist
  '/js/app.js',

  '/images/icon-192.png',
  '/images/icon-512.png',
];

// ── Install: pre-cache static assets ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS.filter(url => {
        // Only cache URLs that are likely to exist — skip missing assets silently
        return true;
      })))
      .then(() => self.skipWaiting()) // activate immediately
      .catch((err) => console.warn('[SW] Pre-cache failed (some assets may be missing):', err.message))
  );
});

// ── Activate: clean up old caches ────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim()) // take control of all open pages immediately
  );
});

// ── Fetch: routing strategy ──────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle API calls — always Network-Only (never cache auth/business data).
  // SW_API_BASE is declared at top of this file. Guard with || to be safe.
  const _apiBase = (typeof SW_API_BASE === 'string' && SW_API_BASE) ? SW_API_BASE : location.origin;
  let _apiOrigin;
  try { _apiOrigin = new URL(_apiBase).origin; } catch (_) { _apiOrigin = location.origin; }

  const isApiCall = url.pathname.startsWith('/api/') || url.origin === _apiOrigin;

  if (isApiCall) {
    // Build a clean cross-origin Request.
    // Never re-use the original Request object cross-origin: its mode may be
    // 'same-origin' or 'navigate', which throws TypeError cross-origin.
    let fetchUrl = request.url;
    if (url.origin !== _apiOrigin && url.pathname.startsWith('/api/')) {
      fetchUrl = _apiBase + url.pathname + url.search;
    }

    // Clone headers so we can safely read them
    const headersCopy = {};
    request.headers.forEach((v, k) => { headersCopy[k] = v; });

    const cleanInit = {
      method:      request.method,
      headers:     headersCopy,
      mode:        'cors',
      credentials: 'include',
      redirect:    'follow',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      cleanInit.body = request.clone().body;
      cleanInit.duplex = 'half';
    }
    const cleanRequest = new Request(fetchUrl, cleanInit);

    // ── NEVER CACHE ANY API CALL ─────────────────────────────────────────────
    // 1. /auth/* (login, logout, me) must never be cached — stale /auth/me
    //    causes ghost sessions after logout on every platform including Android.
    // 2. All other /api/v1/* calls go network-only too. The SW has no business
    //    caching business data (orders, products, leads) — staleness causes
    //    incorrect UI state and is the source of most "data not loading" bugs.
    //    Caching is handled at the application layer (DataCache in network.js).
    //
    // ANDROID WEBVIEW: The SW also acts as a CORS proxy here — it rewrites
    // relative /api/* requests to the full Railway URL. If the WebView fires a
    // fetch that hits the SW with a relative URL (before window.fetch is patched),
    // this ensures it still reaches the backend.
    event.respondWith(fetch(cleanRequest));
    return;
  }

  // Only handle same-origin requests for everything else
  if (url.origin !== location.origin) return;

  // JS files that contain app logic → Network-First (they change on deploy)
  // CSS and images → Cache-First (fast loads, versioned by CACHE_NAME bump)
  if (request.destination === 'script') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Static assets (CSS/images/fonts) → Cache-First
  if (
    request.destination === 'style'  ||
    request.destination === 'image'  ||
    request.destination === 'font'
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // HTML pages → Network-First with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithOfflineFallback(request));
    return;
  }
});

// ── Strategies ───────────────────────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone()); // cache for next time
    }
    return response;
  } catch {
    return new Response('Asset not available offline', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Cache API only supports GET — never attempt to cache POST/PUT/DELETE/PATCH.
    // Trying to cache non-GET requests throws "Request method 'POST' is unsupported".
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Only serve cached fallback for GET requests — mutations must not replay stale data.
    if (request.method !== 'GET') {
      return new Response(
        JSON.stringify({ success: false, message: 'You are offline. Please check your connection.' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const cached = await caches.match(request);
    return cached || new Response(
      JSON.stringify({ success: false, message: 'You are offline. Please check your connection.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function networkFirstWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Show offline page
    const offlinePage = await caches.match(OFFLINE_URL);
    return offlinePage || new Response(
      '<h1>You are offline</h1><p>Please check your internet connection and try again.</p>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}
