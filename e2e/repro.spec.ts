import { mkdirSync, writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function clearStorage(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    indexedDB.deleteDatabase("catm");
    localStorage.setItem("catm:onboarded", "1");
    const root = await navigator.storage.getDirectory();
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
      await root.removeEntry(name, { recursive: true });
    }
  });
  await page.reload();
}

// Exact text from the user's report.
const USER_TEXT = `Over the past decade, deep learning has achieved nothing short of a technological revolution, starting with remarkable results on perceptual tasks from 2013 to 2017, then making fast progress on natural language processing tasks from 2017 to 2022, and culminating with a wave of transformative generative AI applications from 2022 to now.

Deep learning has enabled major breakthroughs, all in extremely challenging problems that had long eluded machines:

Fluent and highly versatile chatbots such as ChatGPT and Gemini
Programming assistants like GitHub Copilot
Photorealistic image generation
Human-level image classification
Human-level speech transcription
Human-level handwriting transcription and printed text transcription
Dramatically improved machine translation
Dramatically improved text-to-speech conversion
Human-level autonomous driving, already deployed to the public in Phoenix, San Francisco, Los Angeles, and Austin as of 2025
Improved recommender systems, as used by YouTube, Netflix, or Spotify
Superhuman Go, Chess, and Poker playing
We're still exploring the full extent of what deep learning can do. We've started applying it with great success to a wide variety of problems that were thought to be impossible to solve just a few years ago — automatically transcribing the tens of thousands of ancient manuscripts held in the Vatican Secret Archive, detecting and classifying plant diseases in fields using a simple smartphone, assisting oncologists or radiologists with interpreting medical imaging data, predicting natural disasters such as floods, hurricanes, and even earthquakes. With every milestone, we're getting closer to an age where deep learning assists us in every activity and every field of human endeavor — science, medicine, manufacturing, energy, transportation, software development, agriculture, and even artistic creation.`;

interface Capture {
  totalDurationSec: number;
  totalSamples: number;
  sampleRate: number;
  chunkDurationsFromMeta: number[];
  chunkTextsFromMeta: string[];
  segmentBoundaryTimes: number[];
  // Energy envelope: RMS in 100 ms windows.
  envelope: { tSec: number; rms: number }[];
  // PCM samples (mono Float32) for offline inspection.
  pcm: number[];
  inputText: string;
}

test("repro: pasted DL article — capture saved audio for inspection", async ({ page }, info) => {
  test.setTimeout(8 * 60 * 1000);
  await clearStorage(page);
  await page.waitForFunction(() => document.documentElement.dataset.ttsDevice !== undefined, {
    timeout: 3 * 60 * 1000,
  });

  await page.getByLabel("Text").fill(USER_TEXT);
  await page.getByTestId("speak").click();
  await expect(page.getByText(/^(Generate|Save & generate)/)).toBeVisible({
    timeout: 5 * 60 * 1000,
  });
  await page.waitForTimeout(800);

  const cap: Capture = await page.evaluate(async (inputText) => {
    const root = await navigator.storage.getDirectory();
    const sessions = await root.getDirectoryHandle("sessions");
    let dir: FileSystemDirectoryHandle | null = null;
    for await (const handle of (
      sessions as unknown as { values(): AsyncIterable<FileSystemHandle> }
    ).values()) {
      if (handle.kind === "directory") dir = handle as FileSystemDirectoryHandle;
    }
    if (!dir) throw new Error("no session dir");

    const names: string[] = [];
    for await (const [name] of (
      dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }
    ).entries()) {
      names.push(name);
    }
    const segNames = names
      .filter((n) => n.startsWith("seg-"))
      .sort(
        (a, b) =>
          Number.parseInt(a.replace(/\D/g, ""), 10) - Number.parseInt(b.replace(/\D/g, ""), 10),
      );

    // Read playlist to know per-segment durations.
    const playlistBytes = await (await (await dir.getFileHandle("playlist.m3u8")).getFile()).text();
    const extInfs: number[] = [];
    for (const raw of playlistBytes.split("\n")) {
      const m = raw.match(/^#EXTINF:([\d.]+)/);
      if (m?.[1]) extInfs.push(Number.parseFloat(m[1]));
    }

    // Read meta from IndexedDB to get chunkDurations.
    const dbOpen = indexedDB.open("catm");
    const dbase = await new Promise<IDBDatabase>((res, rej) => {
      dbOpen.onsuccess = () => res(dbOpen.result);
      dbOpen.onerror = () => rej(dbOpen.error);
    });
    const tx = dbase.transaction("sessions", "readonly");
    const sessionRow = await new Promise<unknown>((res, rej) => {
      const req = tx.objectStore("sessions").getAll();
      req.onsuccess = () => res((req.result as unknown[])[0]);
      req.onerror = () => rej(req.error);
    });
    dbase.close();
    const chunkDurations = (sessionRow as { chunkDurations?: number[] }).chunkDurations ?? [];
    const chunkTexts = (sessionRow as { chunkTexts?: string[] }).chunkTexts ?? [];

    // Decode all segments concatenated.
    const buffers: ArrayBuffer[] = [];
    buffers.push(await (await (await dir.getFileHandle("init.mp4")).getFile()).arrayBuffer());
    for (const n of segNames) {
      buffers.push(await (await (await dir.getFileHandle(n)).getFile()).arrayBuffer());
    }
    const total = buffers.reduce((s, b) => s + b.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const b of buffers) {
      merged.set(new Uint8Array(b), off);
      off += b.byteLength;
    }
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const decoded = await new Ctx().decodeAudioData(merged.buffer);
    const pcm = decoded.getChannelData(0);

    // 100 ms RMS envelope.
    const windowSize = Math.floor(decoded.sampleRate * 0.1);
    const envelope: { tSec: number; rms: number }[] = [];
    for (let i = 0; i + windowSize <= pcm.length; i += windowSize) {
      let s = 0;
      for (let j = 0; j < windowSize; j++) {
        const x = pcm[i + j] ?? 0;
        s += x * x;
      }
      envelope.push({
        tSec: i / decoded.sampleRate,
        rms: Math.sqrt(s / windowSize),
      });
    }

    // Segment boundary times = cumulative sum of extInfs.
    const segmentBoundaryTimes: number[] = [];
    let acc = 0;
    for (const d of extInfs) {
      acc += d;
      segmentBoundaryTimes.push(acc);
    }

    return {
      totalDurationSec: decoded.duration,
      totalSamples: pcm.length,
      sampleRate: decoded.sampleRate,
      chunkDurationsFromMeta: chunkDurations,
      chunkTextsFromMeta: chunkTexts,
      segmentBoundaryTimes,
      envelope,
      pcm: Array.from(pcm),
      inputText,
    };
  }, USER_TEXT);

  const outDir = info.outputDir;
  mkdirSync(outDir, { recursive: true });

  // Write a WAV so I can listen to it locally.
  const wavBytes = floatsToWav(cap.pcm, cap.sampleRate);
  writeFileSync(`${outDir}/audio.wav`, wavBytes);

  // Write a JSON summary (no PCM, since it's large).
  const summary = {
    totalDurationSec: cap.totalDurationSec,
    totalSamples: cap.totalSamples,
    sampleRate: cap.sampleRate,
    inputWordCount: cap.inputText.trim().split(/\s+/).filter(Boolean).length,
    wordsPerSec: cap.inputText.trim().split(/\s+/).filter(Boolean).length / cap.totalDurationSec,
    chunkDurationsFromMeta: cap.chunkDurationsFromMeta,
    chunkTextsFromMeta: cap.chunkTextsFromMeta,
    cumulativeChunkBoundaries: cumSum(cap.chunkDurationsFromMeta),
    segmentBoundaryTimes: cap.segmentBoundaryTimes,
  };
  writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));

  // Print quiet regions (RMS < 5% of max).
  const maxRms = cap.envelope.reduce((m, e) => Math.max(m, e.rms), 0);
  const quietThresh = maxRms * 0.05;
  const quietRegions: { startSec: number; endSec: number }[] = [];
  let qStart: number | null = null;
  for (const e of cap.envelope) {
    if (e.rms < quietThresh) {
      qStart ??= e.tSec;
    } else if (qStart !== null) {
      quietRegions.push({ startSec: qStart, endSec: e.tSec });
      qStart = null;
    }
  }
  if (qStart !== null)
    quietRegions.push({ startSec: qStart, endSec: cap.envelope[cap.envelope.length - 1]!.tSec });
  // Keep only regions >300 ms (single-word gaps / inter-syllable pauses are
  // shorter than that; dropped phrases are typically longer).
  const longQuiet = quietRegions.filter((r) => r.endSec - r.startSec > 0.3);
  writeFileSync(
    `${outDir}/quiet-regions.json`,
    JSON.stringify({ maxRms, quietThresh, longQuiet }, null, 2),
  );

  console.log(`audio.wav written to ${outDir}/audio.wav`);
  console.log(`summary: ${JSON.stringify(summary, null, 2)}`);
  console.log(`long quiet regions (>300ms): ${JSON.stringify(longQuiet, null, 2)}`);

  // Snapshot of the chunk array the synthesis pipeline produces for USER_TEXT.
  // Pinned as a literal (not derived from USER_TEXT at runtime) so a real diff
  // is shown on regression — and because the prior set-membership assertion
  // joined chunks with " " (`splitToFit` preserves text via empty-string
  // concat; " " invents fake word boundaries) which hid real changes.
  //
  // Note: USER_TEXT's newlines are stripped before reaching the splitter
  // because Playwright's .fill() on a contenteditable="plaintext-only" div
  // drops embedded \n. That's why bullet lines are run together
  // ("GeminiProgramming", "now.Deep", etc.). This snapshot reflects current
  // end-to-end behavior; if the input round-trip is ever fixed, this literal
  // will need to be regenerated.
  const EXPECTED_CHUNK_TEXTS = [
    "Over the past decade, deep learning has achieved nothing short of a technological revolution, starting with remarkable results on perceptual tasks from 2013 to 2017, then making fast progress on natural language processing tasks from 2017 to 2022, and culminating with a wave of transformative",
    " generative AI applications from 2022 to now.Deep learning has enabled major breakthroughs, all in extremely challenging problems that had long eluded machines:Fluent and highly versatile chatbots such as ChatGPT and GeminiProgramming assistants like GitHub CopilotPhotorealistic",
    " image generationHuman-level image classificationHuman-level speech transcriptionHuman-level handwriting transcription and printed text transcriptionDramatically improved machine translationDramatically improved text-to-speech conversionHuman-level autonomous driving,",
    " already deployed to the public in Phoenix, San Francisco, Los Angeles, and Austin as of 2025Improved recommender systems, as used by YouTube, Netflix, or SpotifySuperhuman Go, Chess, and Poker playingWe're still exploring the full extent of what deep learning can do.",
    "We've started applying it with great success to a wide variety of problems that were thought to be impossible to solve just a few years ago — automatically transcribing the tens of thousands of ancient manuscripts held in the Vatican Secret Archive,",
    " detecting and classifying plant diseases in fields using a simple smartphone, assisting oncologists or radiologists with interpreting medical imaging data, predicting natural disasters such as floods, hurricanes, and even earthquakes.",
    "With every milestone, we're getting closer to an age where deep learning assists us in every activity and every field of human endeavor — science, medicine, manufacturing, energy, transportation, software development, agriculture, and even artistic creation.",
  ];
  expect(cap.chunkTextsFromMeta).toEqual(EXPECTED_CHUNK_TEXTS);
});

function cumSum(xs: number[]): number[] {
  const out: number[] = [];
  let s = 0;
  for (const x of xs) {
    s += x;
    out.push(s);
  }
  return out;
}

function floatsToWav(pcm: number[], sampleRate: number): Buffer {
  const numSamples = pcm.length;
  const buf = Buffer.alloc(44 + numSamples * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + numSamples * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buf;
}
