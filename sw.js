/**
 * sw.js — Service Worker for offline capability
 * Strategy: Network-first for HTML (always fresh), cache-first for other assets.
 */

const CACHE_NAME = 'voicenotes-v3';

const STATIC_ASSETS = [
  './manifest.json',
];

// ── Install ───────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Always network for YouTube resources
  if (url.hostname.includes('youtube.com') || url.hostname.includes('ytimg.com')) return;

  // Navigation requests (HTML pages): network-first so the shell is always fresh
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Same-origin assets (JS, CSS, icons): cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for Google Fonts and other external resources
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
