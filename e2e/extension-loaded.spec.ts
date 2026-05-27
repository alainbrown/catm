// End-to-end test that actually loads the unpacked extension into Chromium
// via a persistent context, navigates to the bundled extension app, and
// drives the real ingest path: service-worker → chrome.storage.session →
// extension app reads onChanged → editor populated.
//
// We can't fire `chrome.contextMenus.onClicked` from outside the browser
// (no public API), so the background handler's body is exposed as
// `globalThis.__catmIngestSelection` and the test invokes it via
// `serviceWorker.evaluate(...)`. We pass `windowId: null` to skip the
// `chrome.sidePanel.open()` call — that API requires a synchronous user
// gesture, which Playwright SW evaluate doesn't qualify as. Everything
// downstream of `chrome.storage.session.set` is the production flow.

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, type Worker } from "@playwright/test";
import { expect, test, watchPageErrors } from "./fixtures";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const EXT_DIR = join(REPO_ROOT, "extension");
const APP_INDEX = join(EXT_DIR, "app", "index.html");

test.beforeAll(() => {
  // The unpacked extension references app/index.html as its side_panel and
  // its popout target. Build once if it's not there yet.
  if (!existsSync(APP_INDEX)) {
    execSync("npm run build", { stdio: "inherit", cwd: REPO_ROOT });
  }
});

async function launchWithExtension(): Promise<{
  ctx: BrowserContext;
  sw: Worker;
  extId: string;
}> {
  const userDataDir = mkdtempSync(join(tmpdir(), "catm-ext-profile-"));
  // Old headless mode strips extensions; "new headless" supports them. The
  // headless flag must be passed via args (Playwright's `headless: true` uses
  // old headless even on recent Chromium).
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--enable-features=SharedArrayBuffer",
    ],
  });

  // The MV3 service worker spins up lazily — wait for it before driving.
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).hostname;
  return { ctx, sw, extId };
}

async function readyExtensionApp(
  page: import("@playwright/test").Page,
  extId: string,
): Promise<void> {
  // Open the bundled extension app in a tab (same URL the popout button
  // uses). It's the same origin and same app as the side panel, so the
  // ingest path is identical — and it's reachable from Playwright without
  // the gesture restrictions of `chrome.sidePanel.open`.
  await page.goto(`chrome-extension://${extId}/app/index.html?ctx=tab`);
  await page.evaluate(() => {
    indexedDB.deleteDatabase("catm");
    localStorage.setItem("catm:onboarded", "1");
  });
  await page.reload();
  // App.tsx sets document.documentElement.dataset.ttsDevice as soon as the
  // worker reports `ready`. Status-bound and survives UI text changes.
  await page.waitForFunction(() => document.documentElement.dataset.ttsDevice !== undefined, {
    timeout: 3 * 60 * 1000,
  });
}

test.describe("loaded extension end-to-end", () => {
  test("right-click → small selection lands in editor", async () => {
    test.setTimeout(4 * 60 * 1000);
    const { ctx, sw, extId } = await launchWithExtension();
    try {
      const page = await ctx.newPage();
      const assertNoPageErrors = watchPageErrors(page, "small selection");
      await readyExtensionApp(page, extId);

      await sw.evaluate(
        async ({ text }: { text: string }) =>
          // @ts-expect-error global injected by background.js
          (globalThis as never).__catmIngestSelection({
            text,
            tabTitle: "source tab",
            tabUrl: "https://example.test/article",
            windowId: null,
          }),
        { text: "Selection from a real extension load." },
      );

      await expect(page.getByTestId("text-input")).toHaveText(
        "Selection from a real extension load.\n\nhttps://example.test/article",
        { timeout: 30_000 },
      );
      assertNoPageErrors();
    } finally {
      await ctx.close();
    }
  });

  // The original regression guarded against URL length truncation when the
  // old extension redirected a tab with ?text=…. The new hand-off goes
  // through chrome.storage.session (Chrome doc: ~10 MB per extension), so
  // 200 KB sits well within quota — but the test still verifies the bytes
  // round-trip end-to-end (storage.session.set → onChanged → React state →
  // editor DOM) without truncation, structured-clone surprises, or DOM-text
  // collapse.
  test("right-click → 200 KB selection lands intact end-to-end", async () => {
    test.setTimeout(4 * 60 * 1000);
    const { ctx, sw, extId } = await launchWithExtension();
    try {
      const page = await ctx.newPage();
      const assertNoPageErrors = watchPageErrors(page, "200 KB selection");
      await readyExtensionApp(page, extId);

      const line = "The quick brown fox jumps over the lazy dog.";
      const big = Array(4500).fill(line).join("\n");
      expect(big.length).toBeGreaterThan(200_000);

      await sw.evaluate(
        async ({ text }: { text: string }) =>
          // @ts-expect-error global injected by background.js
          (globalThis as never).__catmIngestSelection({
            text,
            tabTitle: null,
            tabUrl: null,
            windowId: null,
          }),
        { text: big },
      );

      const editor = page.getByTestId("text-input");
      await expect
        .poll(async () => editor.evaluate((el) => (el.textContent ?? "").length), {
          timeout: 60_000,
        })
        .toBe(big.length);
      assertNoPageErrors();
    } finally {
      await ctx.close();
    }
  });
});
