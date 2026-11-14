/* Private responses are never stored in CacheStorage. Audio belongs in IndexedDB only after an explicit download. */
const CACHE = "__BUILD_CACHE__";
const SHELL = /*__SHELL__*/ [];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const path of SHELL) {
        const response = await fetch(
          new Request(path, { cache: "reload", redirect: "error" }),
        );
        if (
          !response.ok ||
          response.redirected ||
          new URL(response.url).origin !== self.location.origin
        )
          throw Error("Authenticate online to prepare offline listening");
        if (
          path.startsWith("/assets/") &&
          response.headers.get("Content-Type")?.includes("text/html")
        )
          throw Error("Unexpected authentication page");
        await cache.put(path, response);
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("still-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/cdn-cgi/")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(event.request);
        } catch {
          return (await caches.match("/")) || Response.error();
        }
      })(),
    );
    return;
  }
  if (SHELL.includes(url.pathname))
    event.respondWith(
      caches
        .match(url.pathname)
        .then((cached) => cached || fetch(event.request)),
    );
});
