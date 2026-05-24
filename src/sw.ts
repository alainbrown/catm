// catm service worker. Four jobs:
//
//   1. Inject COOP/COEP/CORP headers on every response so the page becomes
//      `crossOriginIsolated` (unlocks SharedArrayBuffer / multi-threaded WASM
//      on GitHub Pages, which can't set the headers itself).
//   2. Precache the built app shell so catm loads and runs fully offline.
//   3. Cache-first the Kokoro model weights from huggingface.co so the ~80MB
//      download survives HTTP-cache eviction.
//   4. Serve `index.html` from precache as a navigation fallback when the
//      network is unreachable or the URL isn't a known asset (deep links,
//      offline reloads).
//
// This file is bundled by vite-plugin-pwa (injectManifest strategy). The
// project tsconfig includes both DOM and WebWorker libs, so we cast `self`
// to the SW global type rather than fight the type system.

type WBManifestEntry = string | { url: string; revision: string | null };

const sw = self as unknown as ServiceWorkerGlobalScope;

const PRECACHE = "catm-precache-v2";
const MODEL_CACHE = "catm-model-v1";

// Workbox replaces the literal `self.__WB_MANIFEST` token below at build time.
// It must appear verbatim once in the file for the injection to succeed.
// @ts-expect-error - injected by vite-plugin-pwa at build time
const MANIFEST = (self.__WB_MANIFEST ?? []) as WBManifestEntry[];
const PRECACHE_URLS = MANIFEST.map((e) => (typeof e === "string" ? e : e.url));

// Resolve the navigation-fallback URL ("index.html" within our scope) once.
const NAV_FALLBACK = new URL("./", sw.location.href).pathname;

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // `{ cache: "reload" }` bypasses the HTTP cache so we always pull fresh
      // copies during SW install — important for new deploys.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch((err) => {
            console.warn("[sw] precache failed for", url, err);
          }),
        ),
      );
      // Note: we do NOT call skipWaiting() automatically. The page asks us to
      // activate via a SKIP_WAITING message after the user confirms — see the
      // message handler below. This avoids tearing down an in-progress synth.
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("catm-precache-") && n !== PRECACHE)
          .map((n) => caches.delete(n)),
      );
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void sw.skipWaiting();
  }
});

function withCoiHeaders(res: Response): Response {
  if (res.status === 0) return res;
  const headers = new Headers(res.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function isModelOrigin(url: URL): boolean {
  const h = url.hostname;
  return (
    h === "huggingface.co" || h.endsWith(".huggingface.co") || h === "hf.co" || h.endsWith(".hf.co")
  );
}

async function navigationFallback(): Promise<Response | null> {
  const cache = await caches.open(PRECACHE);
  const candidates = [NAV_FALLBACK, `${NAV_FALLBACK}index.html`, "./", "./index.html"];
  for (const c of candidates) {
    const hit = await cache.match(c);
    if (hit) return withCoiHeaders(hit);
  }
  return null;
}

sw.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === sw.location.origin;
  const isNavigate = req.mode === "navigate";

  event.respondWith(
    (async () => {
      try {
        if (sameOrigin) {
          const cached = await caches.match(req, { cacheName: PRECACHE });
          if (cached) return withCoiHeaders(cached);
          try {
            const fresh = await fetch(req);
            return withCoiHeaders(fresh);
          } catch (err) {
            // Network unreachable — fall back to the app shell for navigations
            // so the user sees catm instead of the browser's offline page.
            if (isNavigate) {
              const fallback = await navigationFallback();
              if (fallback) return fallback;
            }
            throw err;
          }
        }

        if (isModelOrigin(url)) {
          const cache = await caches.open(MODEL_CACHE);
          const cached = await cache.match(req);
          if (cached) return withCoiHeaders(cached);
          const fresh = await fetch(req);
          if (fresh.ok && fresh.status === 200) {
            cache.put(req, fresh.clone()).catch(() => {});
          }
          return withCoiHeaders(fresh);
        }

        const fresh = await fetch(req);
        return withCoiHeaders(fresh);
      } catch (err) {
        if (isNavigate) {
          const fallback = await navigationFallback();
          if (fallback) return fallback;
        }
        console.error("[sw] fetch failed:", req.url, err);
        throw err;
      }
    })(),
  );
});
