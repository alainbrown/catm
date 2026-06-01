import { describe, expect, it } from "vitest";
import { splitToFit } from "../../../src/worker/splitToFit";

const byChars = async (s: string) => s.length;

describe("splitToFit", () => {
  it("returns the input unchanged when it already fits", async () => {
    expect(await splitToFit("hello world", 100, byChars)).toEqual(["hello world"]);
  });

  it("splits at the first whitespace from the midpoint, keeping the whitespace on the right", async () => {
    // "the quick brown fox" has 19 chars; midpoint = 9; index 9 is a space.
    // Left = "the quick" (9), right = " brown fox" (10). Both fit limit 10.
    expect(await splitToFit("the quick brown fox", 10, byChars)).toEqual([
      "the quick",
      " brown fox",
    ]);
  });

  it("recurses on each half until every piece fits", async () => {
    // "alpha beta gamma delta" — 22 chars, limit 8 forces multiple splits.
    const result = await splitToFit("alpha beta gamma delta", 8, byChars);
    expect(result).toEqual(["alpha", " beta", " gamma", " delta"]);
    expect(result.join("")).toBe("alpha beta gamma delta");
    for (const p of result) expect(p.length).toBeLessThanOrEqual(8);
  });

  it("preserves every character: concatenation reproduces the original text", async () => {
    const original =
      "We've started applying it with great success to a wide variety of problems — including detecting plant diseases, transcribing manuscripts, and predicting floods, hurricanes, and earthquakes.";
    const result = await splitToFit(original, 50, byChars);
    expect(result.join("")).toBe(original);
    for (const p of result) expect(p.length).toBeLessThanOrEqual(50);
  });

  it("returns a single oversize word unchanged when there is no whitespace to split on", async () => {
    expect(await splitToFit("supercalifragilisticexpialidocious", 5, byChars)).toEqual([
      "supercalifragilisticexpialidocious",
    ]);
  });
});
