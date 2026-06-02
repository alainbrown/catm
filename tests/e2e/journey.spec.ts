import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { expect, test, withPageErrorWatch } from "./fixtures";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const EXT_DIR = join(REPO_ROOT, "dist");
const APP_INDEX = join(EXT_DIR, "src", "sidepanel", "index.html");

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
      await page.goto(`chrome-extension://${extId}/src/sidepanel/index.html?ctx=tab`);
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

      // Read page (play=false): SW stashes the page HTML; the panel runs
      // Readability on it and drops the article text into the editor, no synth.
      // Via __catmStage — Playwright can't fire a real menu / inject a content tab.
      const ARTICLE_HTML = `<!doctype html><html><head><title>Deep sea</title></head><body><nav>home about</nav><article><h1>The deep sea</h1><p>${LONG_TEXT}</p></article><footer>copyright</footer></body></html>`;
      await sw.evaluate((html: string) => {
        (globalThis as never as { __catmStage: (p: unknown) => void }).__catmStage({
          html,
          play: false,
        });
      }, ARTICLE_HTML);
      await expect(page.getByTestId("text-input")).toContainText("runs entirely in your browser");

      // Read selection (play=true): stages text and auto-synths once ready — no
      // speak.click(). This drives the read-aloud path end to end.
      await sw.evaluate((text: string) => {
        (globalThis as never as { __catmStage: (p: unknown) => void }).__catmStage({
          text,
          play: true,
        });
      }, LONG_TEXT);
      await expect(page.getByTestId("text-input")).toContainText(LONG_TEXT);

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

      // ── Side-panel surface: same origin, no ?ctx=tab, so IS_SIDE_PANEL is
      // true. History now lives in a left slide-in drawer; perf + reset are
      // tab-only. The session, model cache, and OPFS audio all persist across
      // the navigation (same extension origin).
      await page.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
      await page.waitForFunction(() => document.documentElement.dataset.ttsDevice !== undefined);

      // Management chrome is dropped from the panel.
      await expect(page.getByTestId("reset")).toHaveCount(0);
      await expect(page.locator(".perf-section")).toHaveCount(0);

      // The recording isn't reachable until the drawer is opened.
      await page.getByTestId("history-open").click();
      await expect(page.getByTestId("library-row")).toHaveCount(1);

      // Picking a reading opens it and dismisses the drawer (close-on-select).
      await page.getByTestId("library-play").first().click();
      await expect(page.getByTestId("history-open")).toHaveAttribute("aria-expanded", "false");
      await expect
        .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 5_000 })
        .toMatch(/^blob:/);

      // Reopen the drawer and delete the last reading from it.
      await page.getByTestId("history-open").click();
      await page.getByTestId("library-delete").first().click();
      await expect(page.getByTestId("library-empty")).toBeVisible();
    });
  } finally {
    await ctx.close();
  }
});
