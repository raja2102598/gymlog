// Offline shell for Gym Log. Bump VERSION whenever app files change: installed copies only pick up new
// files when this file changes.
const VERSION = "gymlog-v6";
const SHELL = [
  "./", "index.html", "styles.css", "stats.js", "app.js", "config.js", "plan.json",
  "manifest.webmanifest", "vendor/supabase.js",
  "fonts/oswald-latin.woff2", "fonts/ibm-plex-sans-latin.woff2",
  "fonts/ibm-plex-mono-500-latin.woff2", "fonts/ibm-plex-mono-600-latin.woff2",
  "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-origin GETs come from the cache first, so the app opens straight away on weak gym signal; waiting
// on the network first kept it blank for seconds. A new VERSION installs all the new files in the
// background at once, and they're used from the next launch. Anything not cached yet goes to the network
// and is kept for next time. Supabase requests are left alone.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (req.mode === "navigate" && (await cache.match("index.html"))) || Response.error();
      }
    })
  );
});
