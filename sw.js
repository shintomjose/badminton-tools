/* Service Worker — Badminton Tools
 *
 * Strategies (no build step, no hashed file names):
 *  - own HTML/CSS/JS:      network-first  → updates arrive at once, offline from cache
 *  - img/ product photos:  cache-first    → 8.7 MB, never precached, FIFO cap
 *  - CDN (Firebase SDK, Leaflet, fonts): stale-while-revalidate
 *  - Firebase RTDB/Firestore, OSRM, Nominatim, OSM tiles: network-only (pass-through)
 */
"use strict";

const VERSION = "v21";
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
  "./tracker-demo.js",
  "./tracker-entry.js",
  "./tracker-settings.js",
  "./tracker-history.js",
  "./tracker-stats.js",
  "./tracker-profile.js",
  "./tracker-roster.js",
  "./tracker-history.css",
  "./tracker-stats.css",
  "./tracker-profile.css",
  "./pwa.js",
  "./anfahrt.html",
  "./anfahrt.js",
  "./manifest.webmanifest",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png",
  "./vendor/leaflet/images/layers.png",
  "./vendor/leaflet/images/layers-2x.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const CDN_HOSTS = [
  "www.gstatic.com",          // Firebase SDK
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
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
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
    /* /__/auth/*, /__/firebase/* are Firebase Hosting's own helper pages — each
       query string would become a new cache entry, and a stale auth handler
       served offline breaks sign-in. Leave them to the network. */
    if (url.pathname.startsWith("/__/")) return;
    if (url.pathname.includes("/img/") || url.pathname.includes("/icons/")) {
      event.respondWith(cacheFirst(req, IMG_CACHE, IMG_CACHE_MAX));
    } else {
      event.respondWith(networkFirst(req, SHELL_CACHE));
    }
    return;
  }

  if (CDN_HOSTS.includes(url.hostname)) {
    /* CDN scripts stay with the browser: WebKit refuses to run an
       SRI-checked cross-origin script that a service worker answers from
       its cache (iOS lost every Firebase script on the second load). The
       CDN sends them with a one-year max-age, so the HTTP cache covers
       offline use. Fonts and stylesheets keep stale-while-revalidate.
       Leaflet is vendored (unpkg answered 503 at page load). */
    if (req.integrity || req.destination === "script" || url.pathname.startsWith("/firebasejs/")) return;
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE, event));
  }
});

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req, { cache: "no-cache" });
    if (fresh.ok) { cache.put(req, fresh.clone()); return fresh; }
    /* a 5xx from the host is worse than the copy we already have */
    const stale = await cache.match(req, { ignoreSearch: true });
    return stale || fresh;
  } catch (err) {
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    // navigation offline with no cache hit → app shell
    if (req.mode === "navigate") {
      const shell = await cache.match("./index.html");
      if (shell) return shell;
    }
    throw err;
  }
}

async function cacheFirst(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  /* icons are precached into the shell cache — look there too */
  const cached = (await cache.match(req)) || (await caches.match(req));
  if (cached) return cached;
  const fresh = await fetch(req);
  if (fresh.ok) {
    await cache.put(req, fresh.clone());
    trimCache(cache, maxEntries); // deliberately not awaited
  }
  return fresh;
}

async function staleWhileRevalidate(req, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const refresh = fetch(req)
    .then((fresh) => {
      if (fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => null);
  /* keep the worker alive until the revalidation lands, even when the cached
     copy was already returned */
  if (event && typeof event.waitUntil === "function") event.waitUntil(refresh);
  return cached || refresh.then((r) => {
    if (r) return r;
    throw new Error("offline, no cached copy: " + req.url);
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
