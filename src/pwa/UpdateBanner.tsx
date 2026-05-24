import { useEffect, useState } from "react";

// Listens for the `catm:update-ready` CustomEvent dispatched by main.tsx when
// a new service worker has finished installing and is waiting. Shows a small
// banner; on confirm, posts SKIP_WAITING to the waiting worker — the
// `controllerchange` listener in main.tsx then triggers a one-shot reload.
export function UpdateBanner(): React.JSX.Element | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    const onReady = (e: Event) => {
      const detail = (e as CustomEvent<ServiceWorker>).detail;
      if (detail) setWaiting(detail);
    };
    window.addEventListener("catm:update-ready", onReady);
    return () => window.removeEventListener("catm:update-ready", onReady);
  }, []);

  if (!waiting) return null;

  return (
    <output className="catm-update-banner">
      <span>A new version of catm is ready.</span>
      <button
        type="button"
        onClick={() => {
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        Reload
      </button>
      <button type="button" className="ghost" onClick={() => setWaiting(null)} aria-label="Dismiss">
        ×
      </button>
    </output>
  );
}
