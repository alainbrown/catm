// Build-mode flags used by the app shell to gate browser-extension-specific
// behaviour (side panel ingest, popout button, skip the PWA service worker).
//
// IS_EXTENSION is set at build time via Vite's --mode flag.
// IS_SIDE_PANEL is set at runtime: the popout tab carries ?ctx=tab.

export const IS_EXTENSION: boolean = import.meta.env.MODE === "extension";

export const IS_SIDE_PANEL: boolean =
  IS_EXTENSION &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("ctx") !== "tab";
