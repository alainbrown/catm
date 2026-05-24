import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
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
  ],
  worker: {
    format: "es",
  },
});
