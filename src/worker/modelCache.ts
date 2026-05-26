// Cache Storage layer for the Kokoro weights when running inside the
// extension (no PWA service worker to do this for us).
//
// PWA builds: the SW intercepts these URLs and writes them to the same
// `catm-model-v1` Cache Storage bucket — so this module is a no-op there.
// Extension builds: install a worker-scoped fetch wrapper that does the
// same cache-first routing.

const CACHE_NAME = "catm-model-v1";

const CACHEABLE_HOST_HINTS = ["huggingface.co", "hf.co", "hf-mirror.com"];

function shouldCache(url: string): boolean {
  return CACHEABLE_HOST_HINTS.some((host) => url.includes(host));
}

// Idempotent: safe to call multiple times. Patches `globalThis.fetch` once.
let installed = false;
export function installModelCacheFetch(): void {
  if (installed) return;
  if (typeof caches === "undefined") return;
  installed = true;

  const original = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!shouldCache(url) || (init?.method && init.method !== "GET")) {
      return original(input, init);
    }
    try {
      const cache = await caches.open(CACHE_NAME);
      const hit = await cache.match(url);
      if (hit) return hit;
      const res = await original(input, init);
      if (res.ok && res.status === 200) {
        // Clone before consumer reads the body.
        cache.put(url, res.clone()).catch(() => {
          /* quota / opaque — non-fatal */
        });
      }
      return res;
    } catch {
      return original(input, init);
    }
  };
}
