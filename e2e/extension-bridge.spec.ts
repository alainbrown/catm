// Verifies the app-side half of the "Send to catm" extension bridge: the
// extension's content script writes a `catm:pending-share` payload into the
// page's sessionStorage and fires a `catm:share-ready` event. The app must
// drain it into the editor — without going through the URL, so long
// selections that would blow the URL length cap still land cleanly.
//
// We don't load the real unpacked extension here; we simulate its contract.

import { expect, test } from "@playwright/test";

const PENDING_KEY = "catm:pending-share";

async function readyEditor(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => {
    indexedDB.deleteDatabase("catm");
    localStorage.setItem("catm:onboarded", "1");
  });
  await page.reload();
  await expect(page.getByText(/Ready · paste/i)).toBeVisible({ timeout: 3 * 60 * 1000 });
}

test.describe("extension bridge", () => {
  test("drains a pre-seeded share into the empty draft (fast path)", async ({ page }) => {
    test.setTimeout(4 * 60 * 1000);
    await readyEditor(page);

    // Simulate the extension content script writing before the next navigation.
    await page.evaluate(
      ({ key, payload }) => {
        sessionStorage.setItem(key, JSON.stringify(payload));
      },
      {
        key: PENDING_KEY,
        payload: { text: "Hello from the extension.", title: "src tab", url: "https://x.test/a" },
      },
    );

    // Reload — on mount, ingest reads sessionStorage immediately. We can't
    // wait on "Ready · paste" here because that empty-state hint disappears
    // the instant the draft fills.
    await page.reload();
    const editor = page.getByTestId("text-input");
    await expect(editor).toHaveText("Hello from the extension.\n\nhttps://x.test/a", {
      timeout: 60_000,
    });

    // The payload must have been consumed (so a refresh won't re-import).
    const remaining = await page.evaluate((k) => sessionStorage.getItem(k), PENDING_KEY);
    expect(remaining).toBeNull();
  });

  test("drains a payload delivered after mount via catm:share-ready event", async ({ page }) => {
    test.setTimeout(4 * 60 * 1000);
    await readyEditor(page);

    // After the app is mounted, simulate the content script winning the race
    // late: write sessionStorage, then dispatch the event.
    await page.evaluate(
      ({ key, payload }) => {
        sessionStorage.setItem(key, JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent("catm:share-ready"));
      },
      {
        key: PENDING_KEY,
        payload: { text: "Late arrival.", title: null, url: null },
      },
    );

    await expect(page.getByTestId("text-input")).toHaveText("Late arrival.");
  });

  test("a 200 KB selection (far past any URL cap) lands intact", async ({ page }) => {
    test.setTimeout(4 * 60 * 1000);
    await readyEditor(page);

    // Build a deterministic ~200 KB body. The browser URL cap is ~32 KB in
    // Chrome and the network/service-worker layer caps lower — this payload
    // would have triggered the original "URI too long" error.
    // No trailing newline — contentEditable's textContent collapses it,
    // causing an off-by-one when we compare lengths.
    const line = "The quick brown fox jumps over the lazy dog.";
    const big = Array(4500).fill(line).join("\n");
    expect(big.length).toBeGreaterThan(200_000);

    await page.evaluate(
      ({ key, text }) => {
        sessionStorage.setItem(key, JSON.stringify({ text, title: null, url: null }));
      },
      { key: PENDING_KEY, text: big },
    );

    await page.reload();
    const editor = page.getByTestId("text-input");
    await expect
      .poll(async () => editor.evaluate((el) => (el.textContent ?? "").length), {
        timeout: 60_000,
      })
      .toBe(big.length);
  });

  test("a non-empty draft is not clobbered by an incoming share", async ({ page }) => {
    test.setTimeout(4 * 60 * 1000);
    await readyEditor(page);

    await page.getByTestId("text-input").fill("user's in-progress draft");

    await page.evaluate(
      ({ key, payload }) => {
        sessionStorage.setItem(key, JSON.stringify(payload));
        window.dispatchEvent(new CustomEvent("catm:share-ready"));
      },
      { key: PENDING_KEY, payload: { text: "should NOT overwrite", title: null, url: null } },
    );

    // The draft is preserved.
    await expect(page.getByTestId("text-input")).toHaveText("user's in-progress draft");

    // And the pending payload was still drained (consumed), so the next empty
    // draft won't pick up stale content.
    const remaining = await page.evaluate((k) => sessionStorage.getItem(k), PENDING_KEY);
    expect(remaining).toBeNull();
  });
});
