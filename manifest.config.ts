import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

// COOP/COEP cross-origin isolation is required so the side panel can use
// SharedArrayBuffer (ORT's threaded WASM build). These are valid MV3 manifest
// keys but aren't in @crxjs/vite-plugin's ManifestV3 type, so they're merged
// in via a typed escape hatch below — the emitted dist/manifest.json keeps them.
const crossOriginIsolation = {
  cross_origin_opener_policy: { value: "same-origin" },
  cross_origin_embedder_policy: { value: "require-corp" },
} as const;

export default defineManifest({
  manifest_version: 3,
  name: "catm",
  short_name: "catm",
  description:
    "On-device long-form text-to-speech in a side panel. Right-click → Read selection or Read page.",
  version: pkg.version,
  icons: {
    "16": "public/icons/16.png",
    "24": "public/icons/24.png",
    "32": "public/icons/32.png",
    "48": "public/icons/48.png",
    "128": "public/icons/128.png",
    "512": "public/icons/512.png",
  },
  permissions: ["contextMenus", "storage", "sidePanel", "activeTab", "scripting"],
  action: {
    default_title: "Open catm side panel",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  ...crossOriginIsolation,
} as Parameters<typeof defineManifest>[0]);
