/* Service Worker — Badminton Tools
 *
 * Strategien (kein Build-Step, keine Hash-Dateinamen):
 *  - Eigene HTML/CSS/JS:  network-first  → Updates kommen sofort an, offline aus Cache
 *  - img/ Produktbilder:  cache-first    → 8.7 MB, nie precachen, LRU-Deckel
 *  - CDN (Firebase SDK, Leaflet, Fonts): stale-while-revalidate
 *  - Firebase RTDB/Firestore, OSRM, Nominatim, OSM-Tiles: network-only (Passthrough)
 */
"use strict";

const VERSION = "v3";
const SHELL_CACHE = `shell-${VERSION}`;
const IMG_CACHE = `img-${VERSION}`;
const CDN_CACHE = `cdn-${VERSION}`;
const ALL_CACHES = [SHELL_CACHE, IMG_CACHE, CDN_CACHE];

const IMG_CACHE_MAX = 400; // Produktbilder + Icons

const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./tracker-core.js",
  "./tracker-entry.js",
  "./tracker-history.js",
  "./tracker-stats.js",
  "./tracker-profile.js",
  "./tracker-history.css",
  "./tracker-stats.css",
  "./tracker-profile.css",
  "./pwa.js",
  "./anfahrt.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const CDN_HOSTS = [
  "www.gstatic.com",          // Firebase SDK
  "unpkg.com",                // Leaflet
  "fonts.googleapis.com",     // Font-CSS
  "fonts.gstatic.com",        // Font-Dateien
];

const NETWORK_ONLY_HOSTS = [
  "router.project-osrm.org",
  "nominatim.openstreetmap.org",
  "firebasedatabase.app",
  "firebaseio.com",
  "firestore.googleapis.com",     // Match Tracker — Firestore hat eigenen Offline-Cache
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "apis.google.com",              // Google-Anmeldung (Popup/Redirect)
  "accounts.google.com",
  "tile.openstreetmap.org",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

/* Tipp auf eine Verfügbarkeits-Benachrichtigung: App fokussieren bzw. öffnen */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("./#termine");
    })
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.endsWith(h))) return;

  if (url.origin === self.location.origin) {
    if (url.pathname.includes("/img/") || url.pathname.includes("/icons/")) {
      event.respondWith(cacheFirst(req, IMG_CACHE, IMG_CACHE_MAX));
    } else {
      event.respondWith(networkFirst(req, SHELL_CACHE));
    }
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // Navigation offline ohne Cache-Treffer → App-Shell
    if (req.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh.ok) {
    await cache.put(req, fresh.clone());
    trimCache(cache, maxEntries); // bewusst nicht awaited
  }
  return fresh;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((fresh) => {
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => null);
  return cached || refresh.then((r) => {
    if (r) return r;
    throw new Error("offline, kein Cache: " + req.url);
  });
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // FIFO reicht hier — Keys sind in Einfüge-Reihenfolge
  for (const key of keys.slice(0, keys.length - maxEntries)) {
    await cache.delete(key);
  }
}
