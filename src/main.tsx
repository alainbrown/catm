import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { IS_EXTENSION } from "./runtime";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./app.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The PWA build registers a service worker that injects COOP/COEP headers,
// precaches the app shell, and cache-first-serves the Kokoro weights. The
// extension build doesn't need any of that: COOP/COEP come from the
// extension manifest, app assets are served from chrome-extension://, and
// the worker installs its own cache-first fetch wrapper for model weights.
if (!IS_EXTENSION && "serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: "./" })
      .then((reg) => {
        if (reg.active && !navigator.serviceWorker.controller) {
          window.location.reload();
          return;
        }

        const notify = (worker: ServiceWorker) => {
          window.dispatchEvent(
            new CustomEvent<ServiceWorker>("catm:update-ready", { detail: worker }),
          );
        };

        if (reg.waiting && navigator.serviceWorker.controller) notify(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              notify(installing);
            }
          });
        });

        // Long-lived reader tabs won't navigate, so the browser never
        // re-checks the SW on its own. Poll for updates every 30 min while
        // the tab is alive, and any time the tab becomes visible after
        // being backgrounded.
        const UPDATE_INTERVAL_MS = 30 * 60 * 1000;
        const checkForUpdate = () => {
          reg.update().catch(() => {
            /* offline or transient — try again next tick */
          });
        };
        setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") checkForUpdate();
        });

        // When the new SW takes control after SKIP_WAITING, reload once.
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });
      })
      .catch((err) => console.error("[sw] registration failed:", err));
  });
}
