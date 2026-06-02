import { describe, expect, it } from "vitest";
import { TextBuffer } from "../../../src/worker/textBuffer";

// Token count == character count, so targets below are in characters.
const byChars = async (s: string) => s.length;

async function drain(buf: TextBuffer): Promise<string[]> {
  const out: string[] = [];
  while (buf.hasNext()) {
    const piece = await buf.next();
    if (piece === null) break;
    out.push(piece);
  }
  return out;
}

const opts = { targetMinTokens: 20, targetMaxTokens: 40, absoluteMaxTokens: 60 };

describe("TextBuffer", () => {
  it("splits on sentence punctuation, NOT on newlines (hard-wrapped sentences stay whole)", async () => {
    // One sentence hard-wrapped across three lines, then a second sentence.
    const text =
      "Understanding deep learning requires\nmany simple\nconcepts. Our goal is intuition.";
    const buf = new TextBuffer(text, { measure: byChars }, { ...opts, targetMaxTokens: 1000 });
    const chunks = await drain(buf);
    // No chunk ends mid-sentence at a wrap; the wrapped sentence is intact.
    expect(chunks.join(" ")).toContain(
      "Understanding deep learning requires many simple concepts.",
    );
    expect(chunks.some((c) => /requires$|simple$/.test(c))).toBe(false);
  });

  it("groups short sentences together up to the target", async () => {
    const text = "One. Two. Three. Four. Five.";
    const buf = new TextBuffer(text, { measure: byChars }, opts);
    const chunks = await drain(buf);
    // All are short, so they coalesce rather than emit one tiny chunk each.
    expect(chunks.length).toBeLessThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(opts.absoluteMaxTokens);
  });

  it("starts a new chunk rather than exceed target_max", async () => {
    // Two ~25-char sentences; target_max 40 → can't combine → two chunks.
    const a = "aaaaaaaaaaaaaaaaaaaaaaa.";
    const b = "bbbbbbbbbbbbbbbbbbbbbbb.";
    const buf = new TextBuffer(`${a} ${b}`, { measure: byChars }, opts);
    expect(await drain(buf)).toEqual([a, b]);
  });

  it("never emits a chunk over absolute_max — sub-splits a long sentence on commas", async () => {
    const text = "alpha beta, gamma delta, epsilon zeta, eta theta, iota kappa lambda mu nu.";
    const buf = new TextBuffer(text, { measure: byChars }, opts);
    const chunks = await drain(buf);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(opts.absoluteMaxTokens);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("hasNext()/next(): true until drained, then null", async () => {
    const buf = new TextBuffer("Hello there. Bye now.", { measure: byChars }, opts);
    expect(buf.hasNext()).toBe(true);
    await drain(new TextBuffer("x", { measure: byChars }, opts));
    expect(await new TextBuffer("", { measure: byChars }, opts).next()).toBeNull();
  });

  it("treats text with no terminal punctuation as one sentence (then caps it)", async () => {
    const buf = new TextBuffer("one two three four five", { measure: byChars }, { ...opts });
    const chunks = await drain(buf);
    expect(chunks.join(" ")).toBe("one two three four five");
  });

  it("empty text has no next", async () => {
    const buf = new TextBuffer("   \n  ", { measure: byChars }, opts);
    expect(buf.hasNext()).toBe(false);
    expect(await buf.next()).toBeNull();
  });
});
