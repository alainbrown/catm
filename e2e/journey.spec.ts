import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { expect, test, withPageErrorWatch } from "./fixtures";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const EXT_DIR = join(REPO_ROOT, "extension");
const APP_INDEX = join(EXT_DIR, "app", "index.html");

const LONG_TEXT = [
  "catm is a long-form text-to-speech reader that runs entirely in your browser.",
  "The Kokoro 82 million parameter model is downloaded once and then everything happens locally on your device.",
  "There are no servers, no accounts, no telemetry, and nothing ever leaves the browser.",
  "You can paste articles, drafts, or any text you want read aloud, and catm streams the audio back sentence by sentence as it is synthesized.",
  "Sessions are saved automatically into IndexedDB and the audio fragments live in the Origin Private File System.",
  "Reload the page and your library is still there.",
  "Delete a session and its audio is purged from disk.",
  "Everything is yours, on your own machine.",
].join(" ");

const EDITED_TEXT = `${LONG_TEXT} This sentence was appended after editing.`;

test.beforeAll(() => {
  if (!existsSync(APP_INDEX)) {
    throw new Error(
      `Extension is not built. Run 'npm run build' before 'npx playwright test', or use 'npm test'.`,
    );
  }
});

test("catm full journey on the loaded extension", async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "catm-ext-profile-"));
  // Old headless strips extensions; --headless=new keeps them. Playwright's
  // built-in `headless: true` still uses old headless, so flag via args.
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--headless=new",
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      "--enable-features=SharedArrayBuffer",
    ],
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent("serviceworker");
    const extId = new URL(sw.url()).hostname;

    const page = await ctx.newPage();
    await withPageErrorWatch(page, "catm full journey", async () => {
      await page.goto(`chrome-extension://${extId}/app/index.html?ctx=tab`);
      await page.evaluate(async () => {
        indexedDB.deleteDatabase("catm");
        localStorage.removeItem("catm:onboarded");
        localStorage.removeItem("catm:voice");
        for (const k of await caches.keys()) await caches.delete(k);
        const root = await navigator.storage.getDirectory();
        for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
          await root.removeEntry(name, { recursive: true });
        }
      });
      await page.reload();

      await expect(page.getByTestId("loading-pct")).toBeVisible();
      await expect(page.getByTestId("ready-stamp")).toBeVisible();
      await page.waitForFunction(() => document.documentElement.dataset.ttsDevice !== undefined);

      await page.getByTestId("voice-chip").click();
      await page.getByTestId("voice-am_michael").click();
      await expect(page.getByTestId("voice-chip")).toContainText("am_michael");

      // Ingest path: right-click selection on some other tab fires the
      // background SW's __catmIngestSelection, which writes to
      // chrome.storage.session — the side panel's consumeExtensionShare
      // drains that on mount and via onChanged. windowId:null skips
      // chrome.sidePanel.open() (no user gesture from SW.evaluate).
      await sw.evaluate(
        async ({ text }: { text: string }) =>
          // @ts-expect-error global injected by background.js
          (globalThis as never).__catmIngestSelection({
            text,
            tabTitle: "Example Article",
            windowId: null,
          }),
        { text: LONG_TEXT },
      );
      await expect(page.getByTestId("text-input")).toContainText(LONG_TEXT);

      // "Read it to me" implies action — no speak.click() here. The ingest
      // handler in App.tsx queues synth automatically when the worker is ready.
      const audio = page.getByTestId("audio");
      await expect
        .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src))
        .toMatch(/^blob:/);
      await expect
        .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).duration), {
          timeout: 30_000,
        })
        .toBeGreaterThan(20);

      const stats = await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const sessions = await root.getDirectoryHandle("sessions");
        let sessionDir: FileSystemDirectoryHandle | null = null;
        for await (const [, handle] of (
          sessions as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
        ).entries()) {
          if (handle.kind === "directory") sessionDir = handle as FileSystemDirectoryHandle;
        }
        if (!sessionDir) throw new Error("no session directory in OPFS");

        const fileNames: string[] = [];
        for await (const [name] of (
          sessionDir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
        ).entries()) {
          fileNames.push(name);
        }
        const segNames = fileNames
          .filter((n) => n.startsWith("seg-"))
          .sort(
            (a, b) =>
              Number.parseInt(a.replace(/\D/g, ""), 10) - Number.parseInt(b.replace(/\D/g, ""), 10),
          );

        const buffers: ArrayBuffer[] = [];
        buffers.push(
          await (await (await sessionDir.getFileHandle("init.mp4")).getFile()).arrayBuffer(),
        );
        for (const n of segNames) {
          const h = await sessionDir.getFileHandle(n);
          buffers.push(await (await h.getFile()).arrayBuffer());
        }
        const total = buffers.reduce((s, b) => s + b.byteLength, 0);
        const merged = new Uint8Array(total);
        let off = 0;
        for (const b of buffers) {
          merged.set(new Uint8Array(b), off);
          off += b.byteLength;
        }

        // biome-ignore lint/suspicious/noExplicitAny: cross-browser
        const Ctx = (window.AudioContext ||
          (window as any).webkitAudioContext) as typeof AudioContext;
        const decoded = await new Ctx().decodeAudioData(merged.buffer);
        const pcm = decoded.getChannelData(0);

        let maxAbs = 0;
        let sumSq = 0;
        for (const s of pcm) {
          const a = Math.abs(s);
          if (a > maxAbs) maxAbs = a;
          sumSq += s * s;
        }
        const rms = Math.sqrt(sumSq / pcm.length);
        const thresh = maxAbs * 0.1;
        let loud = 0;
        for (const s of pcm) if (Math.abs(s) > thresh) loud++;

        return {
          segCount: segNames.length,
          samples: pcm.length,
          duration: decoded.duration,
          maxAbs,
          rms,
          loudFraction: loud / pcm.length,
        };
      });

      expect(stats.segCount, "expected multiple HLS segments for 8-sentence input").toBeGreaterThan(
        1,
      );
      expect(stats.duration, "audio overran (model temporal output broken)").toBeLessThan(120);
      expect(stats.maxAbs, "silent audio").toBeGreaterThan(0.01);
      expect(stats.maxAbs, "audio massively over-driven (>>1.0 peak)").toBeLessThan(1.5);
      expect(stats.rms, "audio has near-zero RMS energy (click or silence)").toBeGreaterThan(0.01);
      expect(stats.rms, "audio RMS is way above speech range (saturated)").toBeLessThan(0.5);
      expect(
        stats.loudFraction,
        `only ${(stats.loudFraction * 100).toFixed(1)}% of samples are loud — looks like a click, not speech`,
      ).toBeGreaterThan(0.05);

      const libraryRow = page.getByTestId("library-row");
      await expect(libraryRow).toHaveCount(1);
      await expect(libraryRow.locator(".voice-tag")).toHaveText("am_michael");

      await page.reload();
      await page.waitForFunction(() => document.documentElement.dataset.ttsDevice !== undefined);
      await expect(libraryRow).toHaveCount(1);
      await expect(libraryRow.locator(".voice-tag")).toHaveText("am_michael");
      await expect(page.getByTestId("voice-chip")).toContainText("am_michael");

      await page.getByTestId("library-play").first().click();
      await expect
        .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 5_000 })
        .toMatch(/^blob:/);

      await page.getByTestId("text-input").fill(EDITED_TEXT);
      await expect(page.getByText("Save & generate")).toBeVisible();
      await page.getByTestId("speak").click();
      await expect(page.getByText("Save & generate")).toBeHidden();
      await expect(libraryRow).toHaveCount(1);

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.getByTestId("library-export").first().click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/\.zip$/);

      await page.getByTestId("library-delete").first().click();
      await expect(page.getByTestId("library-empty")).toBeVisible();
    });
  } finally {
    await ctx.close();
  }
});
