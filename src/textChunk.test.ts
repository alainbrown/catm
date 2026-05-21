import { describe, expect, it } from "vitest";
import { chunkText } from "./textChunk";

describe("chunkText", () => {
  it("returns no chunks for empty or whitespace input", () => {
    expect(chunkText("", 100)).toEqual([]);
    expect(chunkText("   \n\n   ", 100)).toEqual([]);
  });

  it("packs short sentences into one chunk", () => {
    const out = chunkText("One. Two. Three.", 100);
    expect(out).toEqual(["One. Two. Three."]);
  });

  it("splits when adding the next sentence would exceed maxChars", () => {
    const out = chunkText("Aaaaa. Bbbbb. Ccccc.", 12);
    expect(out).toEqual(["Aaaaa.", "Bbbbb.", "Ccccc."]);
  });

  it("forces a chunk boundary at paragraph breaks", () => {
    const out = chunkText("First sentence.\n\nSecond sentence.", 1000);
    expect(out).toEqual(["First sentence.", "Second sentence."]);
  });

  it("hard-splits a sentence longer than maxChars at whitespace", () => {
    const long = `${"word ".repeat(50).trim()}.`; // ~250 chars, one sentence
    const out = chunkText(long, 60);
    expect(out.length).toBeGreaterThan(1);
    for (const c of out) expect(c.length).toBeLessThanOrEqual(60);
    // No mid-word splits.
    for (const c of out) expect(c).toMatch(/^(?:word(?: word)*\.?)$/);
  });

  it("does not split on common English abbreviations", () => {
    // Intl.Segmenter handles "Dr." and "etc." without breaking after them.
    const out = chunkText("Dr. Smith arrived. He said hello.", 100);
    expect(out).toEqual(["Dr. Smith arrived. He said hello."]);
  });
});
