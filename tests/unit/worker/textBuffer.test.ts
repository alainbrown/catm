import { describe, expect, it, vi } from "vitest";
import { TextBuffer } from "../../../src/worker/textBuffer";

const byChars = async (s: string) => s.length;
const splitByLine = (t: string) => t.split(/(?<=\n)/).filter((s) => s.length > 0);
// One sentence per slice, so the token-fit step is observable through next().
const splitWhole = (t: string) => (t.length > 0 ? [t] : []);

async function drain(buf: TextBuffer): Promise<string[]> {
  const out: string[] = [];
  while (buf.hasNext()) {
    const piece = await buf.next();
    if (piece === null) break;
    out.push(piece);
  }
  return out;
}

describe("TextBuffer", () => {
  it("yields every piece in order and reconstructs the input", async () => {
    const text = "one\ntwo\nthree\nfour\n";
    const buf = new TextBuffer(
      text,
      { splitSentences: splitByLine, measure: byChars },
      { maxTokens: 1000, batchChars: 4 },
    );
    const pieces = await drain(buf);
    expect(pieces).toEqual(["one\n", "two\n", "three\n", "four\n"]);
    expect(pieces.join("")).toBe(text);
  });

  it("hasNext()/next(): true until drained, then null and false", async () => {
    const buf = new TextBuffer("a\nb\n", { splitSentences: splitByLine, measure: byChars });
    expect(buf.hasNext()).toBe(true);
    expect(await buf.next()).toBe("a\n");
    expect(await buf.next()).toBe("b\n");
    expect(buf.hasNext()).toBe(false);
    expect(await buf.next()).toBeNull();
  });

  it("segments in bounded slices — never the whole text at once", async () => {
    const text = Array.from({ length: 30 }, (_, i) => `line${String(i).padStart(4, "0")}\n`).join(
      "",
    );
    const spy = vi.fn(splitByLine);
    const buf = new TextBuffer(
      text,
      { splitSentences: spy, measure: byChars },
      { maxTokens: 1000, batchChars: 50 },
    );
    const pieces = await drain(buf);

    expect(pieces.join("")).toBe(text);
    expect(spy.mock.calls.length).toBeGreaterThan(1);
    for (const [arg] of spy.mock.calls) {
      expect(arg.length).toBeLessThan(text.length);
      expect(arg.length).toBeLessThanOrEqual(50 + 9);
      expect(arg.endsWith("\n")).toBe(true);
    }
  });

  it("only refills when the queue is drained (lazy, not eager)", async () => {
    const text = "a\nb\nc\nd\ne\nf\n";
    const spy = vi.fn(splitByLine);
    const buf = new TextBuffer(
      text,
      { splitSentences: spy, measure: byChars },
      { maxTokens: 1000, batchChars: 2 },
    );
    expect(spy).not.toHaveBeenCalled();
    await buf.next();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("empty text has no next", async () => {
    const buf = new TextBuffer("", { splitSentences: splitByLine, measure: byChars });
    expect(buf.hasNext()).toBe(false);
    expect(await buf.next()).toBeNull();
  });
});

describe("TextBuffer token fitting", () => {
  it("keeps a sentence that already fits as a single piece", async () => {
    const buf = new TextBuffer(
      "hello world",
      { splitSentences: splitWhole, measure: byChars },
      { maxTokens: 100 },
    );
    expect(await drain(buf)).toEqual(["hello world"]);
  });

  it("splits an oversize sentence at whitespace; pieces fit and reconstruct", async () => {
    const buf = new TextBuffer(
      "alpha beta gamma delta",
      { splitSentences: splitWhole, measure: byChars },
      { maxTokens: 8 },
    );
    const pieces = await drain(buf);
    expect(pieces).toEqual(["alpha", " beta", " gamma", " delta"]);
    expect(pieces.join("")).toBe("alpha beta gamma delta");
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(8);
  });

  it("returns a single oversize word unchanged when there is no whitespace to split on", async () => {
    const buf = new TextBuffer(
      "supercalifragilisticexpialidocious",
      { splitSentences: splitWhole, measure: byChars },
      { maxTokens: 5 },
    );
    expect(await drain(buf)).toEqual(["supercalifragilisticexpialidocious"]);
  });
});
