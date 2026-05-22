import { expect, test } from "@playwright/test";

// Drives the full onboarding + first-synth flow on WebGPU and asserts the
// output PCM (read from OPFS HLS segments) is speech-shaped, not silence,
// not a click, not saturated noise.
test("WebGPU synth produces speech-shaped audio (no silence, click, or saturation)", async ({
  page,
}) => {
  test.setTimeout(4 * 60 * 1000);

  const consoleLog: string[] = [];
  page.on("console", (msg) => consoleLog.push(`[${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (e) => consoleLog.push(`[pageerror] ${e.message}`));

  await page.goto("/");
  await page.evaluate(async () => {
    indexedDB.deleteDatabase("catm");
    localStorage.removeItem("catm:onboarded");
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.reload();

  // Sanity: the browser itself reports WebGPU available.
  const hasGpu = await page.evaluate(async () => {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    if (!gpu) return false;
    return !!(await gpu.requestAdapter());
  });
  test.skip(!hasGpu, "this Chromium build cannot expose WebGPU; see playwright.config.ts");

  await page.getByTestId("start-download").click();
  try {
    await expect(page.getByTestId("ready-stamp")).toBeVisible({ timeout: 3 * 60 * 1000 });
  } catch (err) {
    console.log("---console log on timeout---");
    for (const line of consoleLog) console.log(line);
    throw err;
  }

  const device = await page.evaluate(() => document.documentElement.dataset.ttsDevice);
  expect(device, `kokoro fell back to ${device}; console: ${consoleLog.join(" | ")}`).toBe(
    "webgpu",
  );

  // Prove the session actually ran inference on WebGPU: synth a short phrase,
  // then capture the playing audio through Web Audio and verify it sounds
  // like speech, not a click.
  await page.getByLabel("Text").fill("Quick test of the WebGPU path.");
  await page.getByTestId("speak").click();
  const audio = page.getByTestId("audio");
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 90_000 })
    .toMatch(/^blob:/);
  const duration = await audio.evaluate((el) => (el as HTMLAudioElement).duration);
  expect(duration, "audio element has no duration").toBeGreaterThan(0.3);

  // Read the synthesized HLS segments straight out of OPFS and decode them
  // via Web Audio. This sidesteps the headless playback pipeline (which
  // doesn't deliver samples to AnalyserNode without a real audio device).
  const stats = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const sessions = await root.getDirectoryHandle("sessions");
    let sessionDir: FileSystemDirectoryHandle | null = null;
    for await (const [name, handle] of (
      sessions as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
    ).entries()) {
      void name;
      if (handle.kind === "directory") {
        sessionDir = handle as FileSystemDirectoryHandle;
      }
    }
    if (!sessionDir) throw new Error("no session directory in OPFS");

    const fileNames: string[] = [];
    for await (const [name] of (
      sessionDir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
    ).entries()) {
      fileNames.push(name);
    }
    fileNames.sort();

    // Read init.mp4 + every seg-N.m4s in order, concatenate, then decode as
    // one ISO-BMFF stream. AudioContext.decodeAudioData handles that.
    const buffers: ArrayBuffer[] = [];
    const initHandle = await sessionDir.getFileHandle("init.mp4");
    buffers.push(await (await initHandle.getFile()).arrayBuffer());
    const segNames = fileNames
      .filter((n) => n.startsWith("seg-"))
      .sort((a, b) => {
        const ai = Number.parseInt(a.replace(/\D/g, ""), 10);
        const bi = Number.parseInt(b.replace(/\D/g, ""), 10);
        return ai - bi;
      });
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
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(merged.buffer);
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
      samples: pcm.length,
      sampleRate: decoded.sampleRate,
      duration: decoded.duration,
      segCount: segNames.length,
      maxAbs,
      rms,
      loudFraction: loud / pcm.length,
    };
  });

  const timings = await page.evaluate(() => ({
    wallMs: Number(document.documentElement.dataset.lastSynthWallMs ?? "NaN"),
    audioSec: Number(document.documentElement.dataset.lastSynthAudioSec ?? "NaN"),
  }));
  console.log("synth timings:", JSON.stringify(timings));
  console.log("audio stats:", JSON.stringify(stats, null, 2));
  expect(stats.samples, "no samples captured").toBeGreaterThan(0);

  // Duration. "Quick test of the WebGPU path." is ~6 words, ~2.5 s of speech.
  // q8f16 currently produces ~25 s here, which is the bug we want to catch.
  expect(stats.duration, "audio runs far too long (model temporal output broken)").toBeLessThan(8);

  // Amplitude. Speech samples are floats in roughly [-1, 1] after decode.
  // q8f16 currently produces ~5.8 peak — over-driven garbage.
  expect(stats.maxAbs, "silent audio").toBeGreaterThan(0.01);
  expect(stats.maxAbs, "audio massively over-driven (>>1.0 peak)").toBeLessThan(1.5);

  // RMS energy. Normal speech is roughly 0.05-0.3.
  expect(stats.rms, "audio has near-zero RMS energy (click or silence)").toBeGreaterThan(0.01);
  expect(stats.rms, "audio RMS is way above speech range (saturated)").toBeLessThan(0.5);

  expect(
    stats.loudFraction,
    `only ${(stats.loudFraction * 100).toFixed(1)}% of samples are loud — looks like a click, not speech`,
  ).toBeGreaterThan(0.05);
});
