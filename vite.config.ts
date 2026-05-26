import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Two builds:
//   default          → dist/, with the PWA service worker (catm-app.github.io)
//   --mode extension → extension/app/, no SW; COOP/COEP come from the
//                      extension manifest, and the model is cached in the
//                      same `catm-model-v1` Cache Storage bucket but from the
//                      worker rather than via SW interception.
export default defineConfig(({ mode }) => {
  const isExtension = mode === "extension";
  return {
    base: "./",
    plugins: [
      react(),
      ...(isExtension
        ? []
        : [
            VitePWA({
              strategies: "injectManifest",
              srcDir: "src",
              filename: "sw.ts",
              injectRegister: false,
              manifest: false,
              injectManifest: {
                // Don't precache the model — it lives on huggingface.co and is
                // handled by a runtime cache-first rule inside the SW.
                globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
                maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
              },
              devOptions: {
                enabled: false,
              },
            }),
          ]),
    ],
    build: isExtension
      ? {
          outDir: "extension/app",
          emptyOutDir: true,
        }
      : undefined,
    worker: {
      format: "es",
    },
  };
});
