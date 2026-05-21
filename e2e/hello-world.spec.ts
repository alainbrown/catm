import { expect, test } from "@playwright/test";

test("synth produces audio, persists session, reload restores library", async ({ page }) => {
  test.setTimeout(4 * 60 * 1000);

  await page.goto("/");
  await page.evaluate(async () => {
    indexedDB.deleteDatabase("catm");
    try {
      const root = await navigator.storage.getDirectory();
      for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) {
        await root.removeEntry(name, { recursive: true });
      }
    } catch {
      // OPFS clear best-effort
    }
  });
  await page.reload();

  await expect(page.getByText(/Ready/)).toBeVisible({ timeout: 3 * 60 * 1000 });

  await page.getByLabel("Text").fill("Hello world. Storage milestone.");

  const audio = page.getByTestId("audio");
  await page.getByTestId("speak").click();

  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 90_000 })
    .toMatch(/^blob:/);

  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).duration), {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  await expect(page.getByTestId("library-row")).toHaveCount(1);

  // Reload — session should persist via IndexedDB + OPFS.
  await page.reload();
  await expect(page.getByText(/Ready/)).toBeVisible({ timeout: 3 * 60 * 1000 });
  await expect(page.getByTestId("library-row")).toHaveCount(1);

  // Click the persisted row — audio loads from OPFS.
  await page.getByTestId("library-play").first().click();
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).src), { timeout: 5_000 })
    .toMatch(/^blob:/);
  await expect
    .poll(async () => audio.evaluate((el) => (el as HTMLAudioElement).duration), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);

  // Delete the session — row disappears and audio clears.
  await page.getByTestId("library-delete").first().click();
  await expect(page.getByTestId("library-empty")).toBeVisible();
});
