import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isExtension = mode === "extension";
  return {
    base: "./",
    plugins: [react()],
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
