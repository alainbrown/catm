import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 120_000,
  expect: { timeout: 120_000 },
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // SharedArrayBuffer is required by ORT's threaded WASM build.
          // --enable-unsafe-webgpu + --use-angle=metal (mac) / Vulkan (linux)
          // unlocks WebGPU in headless. The new-headless flag is now default
          // in Playwright's bundled Chromium, so no extra channel switch.
          args: [
            "--enable-features=SharedArrayBuffer,Vulkan",
            "--enable-unsafe-webgpu",
            "--use-angle=default",
            "--disable-vulkan-surface",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60 * 1000,
  },
});
