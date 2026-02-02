const CACHE_NAME = "yakuwaz-chat-cache-v3";
const urlsToCache = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/socket.io/socket.io.js"
];

// Install SW and cache core files
self.addEventListener("install", (event) => {
  console.log("[SW] Installing...");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// Activate SW and clean old caches
self.addEventListener("activate", (event) => {
  console.log("[SW] Activating...");
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// Intercept fetch requests
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== "GET") return;

  // Handle app shell (HTML, CSS, JS)
  if (
    urlsToCache.includes(new URL(req.url).pathname) ||
    req.headers.get("accept").includes("text/html")
  ) {
    event.respondWith(
      caches.match(req).then((cachedRes) => {
        return cachedRes || fetch(req)
          .then((networkRes) => {
            return caches.open(CACHE_NAME).then((cache) => {
              cache.put(req, networkRes.clone());
              return networkRes;
            });
          })
          .catch(() => caches.match("/index.html"));
      })
    );
    return;
  }

  // For other requests, try network first, fallback to cache
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        // Cache dynamically for next offline use
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, networkRes.clone());
          return networkRes;
        });
      })
      .catch(() => caches.match(req))
  );
});

// Optional: listen to messages from app.js (for advanced offline sync)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHE") {
    caches.delete(CACHE_NAME).then(() => {
      console.log("[SW] Cache cleared by app");
    });
  }
});
