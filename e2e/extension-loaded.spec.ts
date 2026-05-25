// End-to-end test that actually loads the unpacked extension into Chromium
// via a persistent context, points it at the local dev server, and drives the
// real bridge: service-worker stash → content script → page sessionStorage →
// app ingest.
//
// We can't fire `chrome.contextMenus.onClicked` from outside the browser
// (no public API), so the background handler's body is exposed as
// `globalThis.__catmHandleSelection` and the test invokes it via
// `serviceWorker.evaluate(...)`. Everything downstream of that call is the
// production flow.

import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROD_ORIGIN = "https://catm-app.github.io";
const TEST_ORIGIN = "http://localhost:5173";

function buildTestExtension(): string {
  const src = join(__dirname, "..", "extension");
  const dst = mkdtempSync(join(tmpdir(), "catm-ext-"));
  cpSync(src, dst, { recursive: true });

  // Rewrite the three places the prod origin is hardcoded so the extension
  // talks to the dev server instead.
  const rewrite = (rel: string) => {
    const p = join(dst, rel);
    const before = readFileSync(p, "utf8");
    const after = before.split(PROD_ORIGIN).join(TEST_ORIGIN);
    writeFileSync(p, after);
  };
  rewrite("manifest.json");
  rewrite("background.js");

  return dst;
}

async function launchWithExtension(): Promise<{
  ctx: BrowserContext;
  swEvaluate: <R, A>(fn: (arg: A) => R | Promise<R>, arg: A) => Promise<R>;
}> {
  const extDir = buildTestExtension();
  const userDataDir = mkdtempSync(join(tmpdir(), "catm-ext-profile-"));
  // Old headless mode strips extensions; "new headless" supports them. The
  // headless flag must be passed via args (Playwright's `headless: true` uses
  // old headless even on recent Chromium).
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
      "--enable-features=SharedArrayBuffer",
    ],
  });

  // The MV3 service worker spins up lazily — wait for it before driving.
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");

  const swEvaluate = async <R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R> =>
    sw.evaluate(fn as never, arg) as Promise<R>;

  return { ctx, swEvaluate };
}

async function readyEditor(page: import("@playwright/test").Page): Promise<void> {
  await page.goto(TEST_ORIGIN);
  await page.evaluate(() => {
    indexedDB.deleteDatabase("catm");
    localStorage.setItem("catm:onboarded", "1");
  });
  await page.reload();
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });
}

test.describe("loaded extension end-to-end", () => {
  test("right-click → small selection lands in editor", async () => {
    test.setTimeout(4 * 60 * 1000);
    const { ctx, swEvaluate } = await launchWithExtension();
    try {
      const page = await ctx.newPage();
      await readyEditor(page);

      await swEvaluate(
        ({ text }: { text: string }) =>
          // @ts-expect-error global injected by background.js
          (globalThis as never).__catmHandleSelection({
            text,
            tabTitle: "source tab",
            tabUrl: "https://example.test/article",
          }),
        { text: "Selection from a real extension load." },
      );

      // openCatm focuses/navigates the existing tab, so wait for that nav,
      // then assert the editor fills.
      await page.waitForURL(`${TEST_ORIGIN}/`);
      await expect(page.getByTestId("text-input")).toHaveText(
        "Selection from a real extension load.\n\nhttps://example.test/article",
        { timeout: 30_000 },
      );
    } finally {
      await ctx.close();
    }
  });

  test("right-click → 200 KB selection lands intact (regression: URL cap)", async () => {
    test.setTimeout(4 * 60 * 1000);
    const { ctx, swEvaluate } = await launchWithExtension();
    try {
      const page = await ctx.newPage();
      await readyEditor(page);

      const line = "The quick brown fox jumps over the lazy dog.";
      const big = Array(4500).fill(line).join("\n");
      expect(big.length).toBeGreaterThan(200_000);

      await swEvaluate(
        ({ text }: { text: string }) =>
          // @ts-expect-error global injected by background.js
          (globalThis as never).__catmHandleSelection({
            text,
            tabTitle: null,
            tabUrl: null,
          }),
        { text: big },
      );

      await page.waitForURL(`${TEST_ORIGIN}/`);
      const editor = page.getByTestId("text-input");
      await expect
        .poll(async () => editor.evaluate((el) => (el.textContent ?? "").length), {
          timeout: 60_000,
        })
        .toBe(big.length);
    } finally {
      await ctx.close();
    }
  });
});
