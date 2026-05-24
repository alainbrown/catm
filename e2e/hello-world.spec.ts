import { expect, test } from "@playwright/test";

async function clearStorage(
  page: import("@playwright/test").Page,
  opts: { onboarded?: boolean } = { onboarded: true },
): Promise<void> {
  await page.goto("/");
  await page.evaluate(async (onboarded: boolean) => {
    indexedDB.deleteDatabase("catm");
    if (onboarded) localStorage.setItem("catm:onboarded", "1");
    else localStorage.removeItem("catm:onboarded");
    try {
      const root = await navigator.storage.getDirectory();
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
        await root.removeEntry(name, { recursive: true });
      }
    } catch {
      /* best effort */
    }
  }, opts.onboarded ?? true);
  await page.reload();
}

test("synth saves session, sidebar persists across reload, delete clears", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await clearStorage(page);

  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  await page.getByLabel("Text").fill("Hello world. Storage milestone.");
  await page.getByTestId("speak").click();

  const audio = page.getByTestId("audio");
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 90_000 })
    .toMatch(/^blob:/);
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).duration), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  await expect(page.getByTestId("library-row")).toHaveCount(1);

  await page.reload();
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });
  await expect(page.getByTestId("library-row")).toHaveCount(1);

  await page.getByTestId("library-play").first().click();
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 5_000 })
    .toMatch(/^blob:/);
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).duration), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  // Audio should NOT autoplay after loading from library.
  const playing = await audio.evaluate((el) => !(el as HTMLAudioElement).paused);
  expect(playing).toBe(false);

  await page.getByTestId("library-delete").first().click();
  await expect(page.getByTestId("library-empty")).toBeVisible();
});

test("editing an open document re-synthesises in place (no duplicate row)", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await clearStorage(page);
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  await page.getByLabel("Text").fill("First version.");
  await page.getByTestId("speak").click();

  const audio = page.getByTestId("audio");
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 90_000 })
    .toMatch(/^blob:/);

  await expect(page.getByTestId("library-row")).toHaveCount(1);

  // Modify the text — modified indicator should appear, Read becomes "Save & read".
  await page.getByLabel("Text").fill("Second version.");
  await expect(page.getByText("Save & read")).toBeVisible();

  await page.getByTestId("speak").click();
  await expect(page.getByText("Save & read")).toBeHidden({ timeout: 90_000 });

  // Still only one row — the existing session was updated in place.
  await expect(page.getByTestId("library-row")).toHaveCount(1);
});

test("voice chip opens popover and closes on outside click", async ({ page }) => {
  await clearStorage(page);
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  await page.getByTestId("voice-chip").click();
  await expect(page.getByRole("heading", { name: /Voice · English/i })).toBeVisible();

  await page.getByLabel("Text").click();
  await expect(page.getByRole("heading", { name: /Voice · English/i })).toBeHidden();
});

test("onboarding: auto-loading screen → ready stamp", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await clearStorage(page, { onboarded: false });

  // No CTA — the loading screen appears immediately and the download starts on its own.
  await expect(page.getByTestId("loading-pct")).toBeVisible();

  // Eventually reaches ready and shows the "Ready ★" stamp.
  await expect(page.getByTestId("ready-stamp")).toBeVisible({ timeout: 3 * 60 * 1000 });
  await expect(page.getByText(/Ready · paste/i)).toBeVisible();

  // Onboarded flag persists — reload, the stamp is gone and we land straight in the editor.
  await page.reload();
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("ready-stamp")).toBeHidden();
});

test("opening and closing the voice popover does not autoplay the audio", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await clearStorage(page);
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  await page.getByLabel("Text").fill("Round trip.");
  await page.getByTestId("speak").click();

  const audio = page.getByTestId("audio");
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 90_000 })
    .toMatch(/^blob:/);

  // Pause after autoplay completes the post-synth one-shot.
  await audio.evaluate((el) => (el as HTMLAudioElement).pause());

  await page.getByTestId("voice-chip").click();
  await expect(page.getByRole("heading", { name: /Voice · English/i })).toBeVisible();
  await page.getByLabel("Text").click();

  // Audio should remain paused — opening the popover must not trigger autoplay.
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).paused), { timeout: 2_000 })
    .toBe(true);
});

test("library row shows the voice the session was recorded with", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await clearStorage(page);
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  // Switch to am_michael via the inline voice chip.
  await page.getByTestId("voice-chip").click();
  await page.getByTestId("voice-am_michael").click();

  await page.getByLabel("Text").fill("Voice tag test.");
  await page.getByTestId("speak").click();
  await expect
    .poll(async () => page.getByTestId("audio").evaluate((el) => (el as HTMLAudioElement).src), {
      timeout: 90_000,
    })
    .toMatch(/^blob:/);

  // The library row should carry the voice tag.
  await expect(page.locator('[data-testid="library-row"] .voice-tag').first()).toHaveText(
    "am_michael",
  );

  // Switching default voice to af_heart marks the open session as modified.
  await page.getByTestId("voice-chip").click();
  await page.getByTestId("voice-af_heart").click();
  await expect(page.getByText("Save & read")).toBeVisible();
});

test("voice picker selects and persists across reload", async ({ page }) => {
  await clearStorage(page);
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  await page.getByTestId("voice-chip").click();
  // af_heart is selected by default.
  await expect(page.getByTestId("voice-af_heart")).toHaveClass(/on/);

  // Pick a different voice.
  await page.getByTestId("voice-am_michael").click();
  // Popover closes after selection; reopen to verify selection.
  await page.getByTestId("voice-chip").click();
  await expect(page.getByTestId("voice-am_michael")).toHaveClass(/on/);
  await expect(page.getByTestId("voice-af_heart")).not.toHaveClass(/on/);

  // Reload — selection persists.
  await page.reload();
  await page.getByTestId("voice-chip").click();
  await expect(page.getByTestId("voice-am_michael")).toHaveClass(/on/);
});

test("reset wipes model, library, and settings; returns to loading screen", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await clearStorage(page);
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  // Make sure there's something to clear.
  await page.getByLabel("Text").fill("To be reset.");
  await page.getByTestId("speak").click();
  await expect(page.getByTestId("library-row")).toHaveCount(1, { timeout: 90_000 });

  await page.getByTestId("reset").click();
  await expect(page.getByTestId("confirm-reset")).toBeVisible();
  await page.getByTestId("confirm-confirm").click();

  // Reset drops the onboarded flag; the loading screen re-appears and the
  // download restarts automatically (no CTA).
  await expect(page.getByTestId("loading-pct")).toBeVisible();
});

test("export downloads a zip containing a single combined audio.mp4", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await clearStorage(page);
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  await page.getByLabel("Text").fill("Export round-trip check.");
  await page.getByTestId("speak").click();
  await expect
    .poll(async () => page.getByTestId("audio").evaluate((el) => (el as HTMLAudioElement).src), {
      timeout: 90_000,
    })
    .toMatch(/^blob:/);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("library-export").first().click(),
  ]);

  const path = await download.path();
  expect(path).toBeTruthy();
  const fs = await import("node:fs");
  const { unzipSync, strFromU8 } = await import("fflate");
  const buf = fs.readFileSync(path!);
  const entries = unzipSync(new Uint8Array(buf));
  const names = Object.keys(entries);

  // Exactly three files in one top-level folder: audio.mp4, source.txt, meta.json.
  expect(names).toHaveLength(3);
  const folder = names[0]!.split("/")[0]!;
  expect(folder).toMatch(/^catm-/);
  expect(new Set(names)).toEqual(
    new Set([`${folder}/audio.mp4`, `${folder}/source.txt`, `${folder}/meta.json`]),
  );

  // audio.mp4 starts with an MP4 ftyp box: bytes 4..8 are the ASCII tag "ftyp".
  const audio = entries[`${folder}/audio.mp4`]!;
  expect(audio.byteLength).toBeGreaterThan(0);
  expect(strFromU8(audio.subarray(4, 8))).toBe("ftyp");

  // source.txt and meta.json carry through.
  expect(strFromU8(entries[`${folder}/source.txt`]!)).toBe("Export round-trip check.");
  const meta = JSON.parse(strFromU8(entries[`${folder}/meta.json`]!));
  expect(meta.title).toBeTruthy();
  expect(meta.voice).toBeTruthy();
});

test("switching to a different session while modified shows discard dialog", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);
  await clearStorage(page);
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });

  // Create session A
  await page.getByLabel("Text").fill("Session A.");
  await page.getByTestId("speak").click();
  await expect
    .poll(async () => page.getByTestId("audio").evaluate((el) => (el as HTMLAudioElement).src), {
      timeout: 90_000,
    })
    .toMatch(/^blob:/);

  // Start a new document via + button, then make session B
  await page.getByTestId("new-document").click();
  await page.getByLabel("Text").fill("Session B.");
  await page.getByTestId("speak").click();
  await expect(page.getByTestId("library-row")).toHaveCount(2);

  // Modify B
  await page.getByLabel("Text").fill("Session B with edits.");

  // Click the inactive (other) row. Expect discard dialog.
  const inactive = page.locator('[data-testid="library-row"]:not(.active)').first();
  await inactive.getByTestId("library-play").click();

  await expect(page.getByTestId("discard-dialog")).toBeVisible();
  await page.getByTestId("discard-cancel").click();
  await expect(page.getByTestId("discard-dialog")).toBeHidden();
});
