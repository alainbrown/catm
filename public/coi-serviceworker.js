// COI service worker — injects COOP / COEP / CORP response headers on the
// client so the page becomes `crossOriginIsolated`. Required for:
//   - performance.measureUserAgentSpecificMemory()
//   - SharedArrayBuffer-backed multi-threaded WASM
//
// Why this exists: catm deploys to GitHub Pages, which can't serve custom
// HTTP headers. A service worker can intercept its own page's responses and
// add the headers from the client side. This is the canonical
// `coi-serviceworker` pattern (github.com/gzuidhof/coi-serviceworker).

if (typeof window === "undefined") {
  // ── Running as the actual service worker ──────────────────────────────
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    // Don't try to handle non-GET or cross-origin same-origin-mode requests.
    if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.status === 0) return res;
          const headers = new Headers(res.headers);
          headers.set("Cross-Origin-Embedder-Policy", "require-corp");
          headers.set("Cross-Origin-Opener-Policy", "same-origin");
          // Tag our own resources so they're loadable cross-origin under COEP.
          headers.set("Cross-Origin-Resource-Policy", "cross-origin");
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
          });
        })
        .catch((e) => {
          console.error("[coi-sw] fetch failed:", e);
          throw e;
        }),
    );
  });
} else {
  // ── Bootstrap (runs on the page) ──────────────────────────────────────
  // If already isolated, do nothing.
  if (window.crossOriginIsolated) {
    // Already good. No-op.
  } else if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register(window.document.currentScript.src)
      .then((reg) => {
        // After the SW activates we need to reload once so the page is
        // served with the injected headers.
        reg.addEventListener("updatefound", () => {
          window.location.reload();
        });
        if (reg.active && !navigator.serviceWorker.controller) {
          window.location.reload();
        }
      })
      .catch((err) => console.error("[coi-sw] registration failed:", err));
  }
}
