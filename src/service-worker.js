/* The offline copy of Gym Log. After each build, scripts/build-sw.mjs writes this to out/sw.js with two
 * constants above it: SHELL, every file of the built site, and VERSION, a hash of them all. So any change
 * to the site changes sw.js, which is how installed copies find out there's an update. */
/* global VERSION, SHELL */

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
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
        return (req.mode === "navigate" && (await cache.match("/"))) || Response.error();
      }
    }),
  );
});
