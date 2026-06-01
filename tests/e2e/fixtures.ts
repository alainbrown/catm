import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

// Playwright Test does not auto-fail on pageerror — race the body against
// the listener so failures surface within a tick instead of at locator timeout.
export async function withPageErrorWatch<T>(
  page: Page,
  label: string,
  body: () => Promise<T> | T,
): Promise<T> {
  let rejectOnError!: (e: Error) => void;
  const errorPromise = new Promise<never>((_, reject) => {
    rejectOnError = reject;
  });
  const onError = (e: Error) => {
    const detail = e.stack || `${e.name}: ${e.message}`;
    console.error(`[pageerror in ${label}] ${detail}`);
    rejectOnError(new Error(`uncaught page error: ${detail}`));
  };
  page.on("pageerror", onError);
  try {
    return await Promise.race([Promise.resolve(body()), errorPromise]);
  } finally {
    page.off("pageerror", onError);
  }
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await withPageErrorWatch(page, testInfo.title, () => use(page));
  },
});
