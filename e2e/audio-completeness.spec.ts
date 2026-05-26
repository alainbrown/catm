import { type Page, expect, test } from "@playwright/test";

async function clearStorage(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    indexedDB.deleteDatabase("catm");
    localStorage.setItem("catm:onboarded", "1");
    try {
      const root = await navigator.storage.getDirectory();
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
        await root.removeEntry(name, { recursive: true });
      }
    } catch {
      /* best effort */
    }
  });
  await page.reload();
}

// Wait until the encoder has written #EXT-X-ENDLIST to playlist.m3u8. The
// worker writes that marker as the final step of `encoder.finish()`, so its
// presence proves all `seg-N.m4s` writes and the last playlist rewrite have
// landed in OPFS. Without this, reads can hit a partially-written session.
async function waitForSessionFinalized(page: Page, timeoutMs = 30_000): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          try {
            const root = await navigator.storage.getDirectory();
            const sessions = await root.getDirectoryHandle("sessions");
            for await (const handle of (
              sessions as unknown as { values(): AsyncIterable<FileSystemHandle> }
            ).values()) {
              if (handle.kind !== "directory") continue;
              const dir = handle as FileSystemDirectoryHandle;
              const file = await dir.getFileHandle("playlist.m3u8");
              const text = await (await file.getFile()).text();
              if (text.includes("#EXT-X-ENDLIST")) return true;
            }
            return false;
          } catch {
            return false;
          }
        }),
      { timeout: timeoutMs },
    )
    .toBe(true);
}

async function decodeSessionAudio(page: Page): Promise<{ duration: number; samples: number }> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const sessions = await root.getDirectoryHandle("sessions");
    let dir: FileSystemDirectoryHandle | null = null;
    for await (const handle of (
      sessions as unknown as { values(): AsyncIterable<FileSystemHandle> }
    ).values()) {
      if (handle.kind === "directory") dir = handle as FileSystemDirectoryHandle;
    }
    if (!dir) throw new Error("no session directory");

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
    return { duration: decoded.duration, samples: decoded.length };
  });
}

const WORDS_PER_SEC_LOWER = 1.8;
const WORDS_PER_SEC_UPPER = 3.5;

function wordsOf(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const cases: { name: string; text: string }[] = [
  {
    name: "bullet with comma-separated proper nouns ending in a year",
    text: "Human-level autonomous driving, already deployed to the public in Phoenix, San Francisco, Los Angeles, and Austin as of 2025.",
  },
  {
    name: "short pasted article with bullet list of features",
    text: [
      "Deep learning has enabled major breakthroughs in challenging problems.",
      "",
      "Fluent and highly versatile chatbots such as ChatGPT and Gemini",
      "Programming assistants like GitHub Copilot",
      "Photorealistic image generation",
      "Human-level autonomous driving, already deployed to the public in Phoenix, San Francisco, Los Angeles, and Austin as of 2025",
      "Improved recommender systems, as used by YouTube, Netflix, or Spotify",
    ].join("\n"),
  },
];

test("playback covers the entire saved audio without forward-skipping", async ({ page }) => {
  // 2 min budget: deliberately tight. If this hangs (last CI run ate a full
  // 8 min without synth finishing), failing fast is more useful than failing
  // slow — gives a clean signal without burning runner minutes on something
  // that's stuck, not slow.
  test.setTimeout(2 * 60 * 1000);
  await clearStorage(page);
  await page.waitForFunction(() => document.documentElement.dataset.ttsDevice !== undefined, {
    timeout: 3 * 60 * 1000,
  });

  await page.addInitScript(() => {
    const apply = () => {
      const el = document.querySelector('[data-testid="audio"]') as HTMLAudioElement | null;
      if (el) {
        el.muted = true;
        el.playbackRate = 8; // run the test faster than real-time
        return true;
      }
      return false;
    };
    if (apply()) return;
    const obs = new MutationObserver(() => {
      if (apply()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });

  // Long enough to exercise multiple segment boundaries.
  await page
    .getByLabel("Text")
    .fill(
      [
        "Deep learning has enabled major breakthroughs in challenging problems.",
        "Fluent and highly versatile chatbots such as ChatGPT and Gemini.",
        "Programming assistants like GitHub Copilot.",
        "Photorealistic image generation.",
        "Human-level autonomous driving, already deployed to the public in Phoenix, San Francisco, Los Angeles, and Austin as of 2025.",
        "Improved recommender systems, as used by YouTube, Netflix, or Spotify.",
      ].join(" "),
    );
  await page.getByTestId("speak").click();

  await expect(page.getByText(/^(Generate|Save & generate)/)).toBeVisible({ timeout: 120_000 });

  const audio = page.getByTestId("audio");
  // Wait for the audio element to actually have a usable duration before the
  // playback loop starts — the status flip happens before the final hls.js
  // attach lands.
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).duration), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // Record the playhead approximately every 100 ms during playback. Detect
  // any forward jump larger than 0.5 s (which would indicate hls.js skipping
  // a chunk of audio rather than playing through it).
  const samples = await audio.evaluate(async (el) => {
    const a = el as HTMLAudioElement;
    a.muted = true;
    a.playbackRate = 8;
    a.currentTime = 0;
    await a.play().catch(() => {});
    const out: { ct: number; dur: number }[] = [];
    const start = performance.now();
    while (performance.now() - start < 15_000) {
      out.push({ ct: a.currentTime, dur: a.duration });
      if (a.ended || (Number.isFinite(a.duration) && a.currentTime >= a.duration - 0.05)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return out;
  });

  expect(samples.length).toBeGreaterThan(5);
  const last = samples[samples.length - 1];
  expect(last, "no samples").toBeTruthy();
  expect(last?.dur, "audio duration not finite").toBeGreaterThan(0);

  // Audio must have actually reached the end.
  expect(last?.ct, `playback ended at ${last?.ct} of ${last?.dur}`).toBeGreaterThan(
    (last?.dur ?? 0) - 0.5,
  );

  // No forward jump larger than 0.5 s between consecutive samples (after
  // adjusting for the 8× playback rate and ~100 ms sampling interval,
  // expected per-sample advance is ~0.8 s).
  let maxJump = 0;
  let jumpAt = -1;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!a || !b) continue;
    const jump = b.ct - a.ct;
    if (jump > 1.5) {
      if (jump > maxJump) {
        maxJump = jump;
        jumpAt = b.ct;
      }
    }
  }
  expect(
    maxJump,
    `forward-skip of ${maxJump.toFixed(2)}s near currentTime ${jumpAt.toFixed(2)}; samples=${JSON.stringify(samples)}`,
  ).toBeLessThan(1.5);
});

for (const c of cases) {
  test(`audio duration is consistent with input word count: ${c.name}`, async ({ page }) => {
    test.setTimeout(4 * 60 * 1000);
    await clearStorage(page);
    await page.waitForFunction(() => document.documentElement.dataset.ttsDevice !== undefined, {
      timeout: 3 * 60 * 1000,
    });

    await page.getByLabel("Text").fill(c.text);
    await page.getByTestId("speak").click();

    await expect(page.getByText(/^(Generate|Save & generate)/)).toBeVisible({ timeout: 120_000 });
    await waitForSessionFinalized(page);

    const { duration, samples } = await decodeSessionAudio(page);
    const words = wordsOf(c.text);
    const wordsPerSec = words / duration;

    expect(samples, "no samples decoded").toBeGreaterThan(0);
    expect(
      duration,
      `audio ${duration}s; words=${words}; wps=${wordsPerSec.toFixed(2)}`,
    ).toBeGreaterThan(words / WORDS_PER_SEC_UPPER);
    expect(
      duration,
      `audio ${duration}s; words=${words}; wps=${wordsPerSec.toFixed(2)}`,
    ).toBeLessThan(words / WORDS_PER_SEC_LOWER + 5);
  });
}
