// sw.js — NetEngKit service worker.
// Makes the served app installable and offline-capable: every client-side
// asset (page, components, languages, CDN libs, fonts) is cached on first
// use, so tools that don't need the backend keep working offline.
// Server-dependent endpoints (/api/*, /proxy/*) always hit the network.
'use strict';

const VERSION = 'v7';
const CACHE = `netengkit-${VERSION}`;

// App shell. Everything else referenced by the page is discovered and
// precached at install (see precacheAll below), so the app is fully
// offline-capable right after the first visit.
const PRECACHE = [
  './',
  'manifest.json',
  'logo.svg',
  'icons/logo.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

const ASSET_EXT = /\.(js|mjs|jsx|css|json|png|svg|jpg|jpeg|webp|ico|woff2?|webmanifest)$/i;

// Backend routes: network only, never served from cache.
const NETWORK_ONLY = ['/api/', '/proxy/'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await precacheAll(cache);
    await self.skipWaiting();
  })());
});

async function precacheAll(cache) {
  const urls = new Set(PRECACHE);
  try {
    // Discover every asset the page references (local files and CDN libs —
    // React, Babel, js-yaml) so a first-time visitor can go fully offline.
    const res = await fetch('./', { cache: 'reload' });
    if (res.ok) {
      cache.put('./', res.clone());
      const html = await res.text();
      for (const m of html.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
        try {
          const u = new URL(m[1], self.registration.scope);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          if (!ASSET_EXT.test(u.pathname)) continue;
          urls.add(u.href);
        } catch (e) { /* malformed URL in markup */ }
      }
    }
  } catch (e) { /* offline install: shell only */ }
  await Promise.allSettled(
    [...urls].map((u) => cache.add(new Request(u, { cache: 'reload' })))
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== CACHE && k.startsWith('netengkit-')).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Backend-backed tools: pass through; the app surfaces fetch failures itself.
  if (url.origin === self.location.origin && NETWORK_ONLY.some((p) => url.pathname.startsWith(p))) {
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
  } else {
    // Local assets + CDN resources (React, Babel, fonts): cache-first with
    // background refresh so the next visit picks up updates.
    event.respondWith(staleWhileRevalidate(req));
  }
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await refresh) || Response.error();
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = (await cache.match(req)) || (await cache.match('./'));
    if (cached) return cached;
    return new Response(
      '<!doctype html><title>NetEngKit — offline</title>' +
      '<p style="font-family:sans-serif">NetEngKit has not been cached yet. ' +
      'Reconnect once to enable offline use.</p>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}
