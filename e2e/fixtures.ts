import { test as base, type Page } from "@playwright/test";

export { expect } from "@playwright/test";

// Returned assert() throws with all captured pageerrors. Call before teardown.
export function watchPageErrors(page: Page, label: string): () => void {
  const errors: Error[] = [];
  page.on("pageerror", (e) => {
    errors.push(e);
    console.error(`[pageerror in ${label}] ${e.stack ?? e.message}`);
  });
  return () => {
    if (errors.length > 0) {
      throw new Error(
        `${errors.length} uncaught page error(s):\n\n` +
          errors.map((e, i) => `${i + 1}. ${e.stack ?? e.message}`).join("\n\n"),
      );
    }
  };
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const assertNoPageErrors = watchPageErrors(page, testInfo.title);
    await use(page);
    assertNoPageErrors();
  },
});
