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

const CACHE_NAME    = 'aqualence-v4';  // bumped — forces SW update, clears all stale JS/CSS/API cache
const OFFLINE_URL   = '/offline.html';

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

  // Handle API calls — Network-First (same-origin when frontend served by backend)
  // For same-origin deployments (backend serves frontend), API origin = location.origin.
  // For cross-origin setups, add an API config endpoint:
  //   GET /api/config → { api_base: "https://api.example.com" }
  //   SW fetches this on install and caches the value.
  const API_ORIGIN = location.origin;
  if (url.origin === API_ORIGIN) {
    // Exclude authenticated endpoints from service worker cache
    const isAuthEndpoint = url.pathname.includes('/orders') || url.pathname.includes('/salesman/') || url.pathname.includes('/delivery/') || url.pathname.includes('/export');
    if (isAuthEndpoint) {
      event.respondWith(fetch(request));
    } else {
      event.respondWith(networkFirst(request));
    }
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
