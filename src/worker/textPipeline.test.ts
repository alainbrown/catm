import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Tokenizer } from "./textPipeline";
import {
  STYLE_DIM,
  expandDecimal,
  expandMoney,
  expandNumberToken,
  kokoroPostProcess,
  normalizeText,
  parseTokenizer,
  phonemizeKokoro,
  sliceStyle,
  splitForPhonemization,
  styleBucket,
  tokenize,
  voiceFileBuckets,
} from "./textPipeline";

// Tiny vocab mirroring the real Kokoro phoneme table for the chars used
// across these tests. Verified against the live tokenizer.json (see comments
// for ids).
const TEST_VOCAB: Record<string, number> = {
  $: 0, // BOS/EOS
  " ": 16,
  ".": 4,
  ",": 3,
  h: 50,
  e: 47,
  l: 54,
  o: 57,
  w: 65,
  r: 60,
  d: 46,
  ˈ: 156,
  ɛ: 86,
  ʊ: 135,
  ɜ: 87,
  ː: 158,
};
const TEST_TOK: Tokenizer = { vocab: TEST_VOCAB, bos: 0, eos: 0, pad: 0, unk: 0 };

describe("expandNumberToken", () => {
  it("formats 4-digit years above 1100", () => {
    expect(expandNumberToken("1999")).toBe("19 99");
    expect(expandNumberToken("2004")).toBe("2004"); // % 1000 == 4, < 10 → returned as-is
    expect(expandNumberToken("1900")).toBe("19 hundred");
    expect(expandNumberToken("1905")).toBe("19 oh 5");
    expect(expandNumberToken("1900s")).toBe("19 hundreds");
  });
  it("formats times", () => {
    expect(expandNumberToken("3:00")).toBe("3 o'clock");
    expect(expandNumberToken("3:05")).toBe("3 oh 5");
    expect(expandNumberToken("3:15")).toBe("3 15");
  });
  it("leaves decimals alone", () => {
    expect(expandNumberToken("3.14")).toBe("3.14");
  });
});

describe("expandMoney", () => {
  it("formats whole dollars", () => {
    expect(expandMoney("$5")).toBe("5 dollars");
    expect(expandMoney("$1")).toBe("1 dollar");
  });
  it("formats dollars and cents", () => {
    expect(expandMoney("$3.50")).toBe("3 dollars and 50 cents");
    expect(expandMoney("$1.01")).toBe("1 dollar and 1 cent");
  });
  it("formats pounds", () => {
    expect(expandMoney("£2.30")).toBe("2 pounds and 30 pence");
    expect(expandMoney("£1.01")).toBe("1 pound and 1 penny");
  });
});

describe("expandDecimal", () => {
  it("speaks digits after the point", () => {
    expect(expandDecimal("3.14")).toBe("3 point 1 4");
    expect(expandDecimal("0.5")).toBe("0 point 5");
  });
});

describe("normalizeText", () => {
  it("is identity for plain text", () => {
    expect(normalizeText("Hello world.")).toBe("Hello world.");
  });
  it("collapses extra spaces", () => {
    expect(normalizeText("a   b")).toBe("a b");
  });
  it("converts smart quotes", () => {
    expect(normalizeText("It’s “Hello”.")).toBe('It\'s "Hello".');
  });
  it("expands Mr./Mrs./Ms./Dr. before a capitalised name", () => {
    expect(normalizeText("Mr. Smith")).toBe("Mister Smith");
    expect(normalizeText("Mrs. Smith")).toBe("Mrs Smith");
    expect(normalizeText("Dr. Smith")).toBe("Doctor Smith");
  });
  it("expands money", () => {
    expect(normalizeText("It cost $3.50.")).toBe("It cost 3 dollars and 50 cents.");
  });
  it("expands years and times", () => {
    expect(normalizeText("In 1999 at 3:05.")).toBe("In 19 99 at 3 oh 5.");
  });
  it("strips a thousands separator", () => {
    expect(normalizeText("1,000 dogs")).toBe("1000 dogs");
  });
});

describe("splitForPhonemization", () => {
  it("splits 'Hello world.' into a word segment and a trailing dot", () => {
    expect(splitForPhonemization("Hello world.")).toEqual([
      { match: false, text: "Hello world" },
      { match: true, text: "." },
    ]);
  });
  it("groups runs of punctuation with adjacent spaces", () => {
    expect(splitForPhonemization("Hi! Bye.")).toEqual([
      { match: false, text: "Hi" },
      { match: true, text: "! " },
      { match: false, text: "Bye" },
      { match: true, text: "." },
    ]);
  });
  it("handles text with no punctuation", () => {
    expect(splitForPhonemization("hello world")).toEqual([{ match: false, text: "hello world" }]);
  });
  it("handles only-punctuation input", () => {
    expect(splitForPhonemization("...")).toEqual([{ match: true, text: "..." }]);
  });
});

describe("kokoroPostProcess", () => {
  it("replaces r with ɹ", () => {
    expect(kokoroPostProcess("rabbit")).toBe("ɹabbit");
  });
  it("replaces ʲ with j", () => {
    expect(kokoroPostProcess("kʲe")).toBe("kje");
  });
  it("replaces x with k and ɬ with l", () => {
    expect(kokoroPostProcess("xɬe")).toBe("kle");
  });
  it("rewrites kəkˈoːɹoʊ to the canonical Kokoro pronunciation", () => {
    expect(kokoroPostProcess("kəkˈoːɹoʊ", "a")).toBe("kˈoʊkəɹoʊ");
  });
  it("applies the en-us 'ninety' → 'nindy' fix", () => {
    expect(kokoroPostProcess("nˈaɪnti", "a")).toBe("nˈaɪndi");
  });
  it("does NOT apply the en-us fix in dialect b", () => {
    expect(kokoroPostProcess("nˈaɪnti", "b")).toBe("nˈaɪnti");
  });
  it("trims trailing whitespace", () => {
    expect(kokoroPostProcess("hello  ")).toBe("hello");
  });
});

describe("tokenize", () => {
  it("wraps tokens in BOS/EOS", () => {
    const ids = tokenize("h", TEST_TOK);
    expect(Array.from(ids, (n) => Number(n))).toEqual([0, 50, 0]);
  });
  it("returns just BOS+EOS for empty input", () => {
    const ids = tokenize("", TEST_TOK);
    expect(Array.from(ids, (n) => Number(n))).toEqual([0, 0]);
  });
  it("maps characters not in the vocab to the unk_token id", () => {
    const tok: Tokenizer = { ...TEST_TOK, unk: 99 };
    const ids = tokenize("h@e", tok); // @ not in test vocab → 99
    expect(Array.from(ids, (n) => Number(n))).toEqual([0, 50, 99, 47, 0]);
  });
  it("tokenizes 'hello world' end-to-end", () => {
    const ids = tokenize("hˈɛloʊ wˈɜːld", TEST_TOK);
    expect(Array.from(ids, (n) => Number(n))).toEqual([
      0, 50, 156, 86, 54, 57, 135, 16, 65, 156, 87, 158, 54, 46, 0,
    ]);
  });
  it("returns a BigInt64Array (model expects int64)", () => {
    expect(tokenize("h", TEST_TOK)).toBeInstanceOf(BigInt64Array);
  });
});

describe("styleBucket", () => {
  it("returns 0 for BOS+EOS-only sequences", () => {
    expect(styleBucket(2, 510)).toBe(0);
  });
  it("returns (length - 2) within range", () => {
    expect(styleBucket(16, 510)).toBe(14);
  });
  it("clamps to maxBuckets-1 at the top", () => {
    expect(styleBucket(1000, 510)).toBe(509);
  });
  it("never goes below 0", () => {
    expect(styleBucket(0, 510)).toBe(0);
    expect(styleBucket(1, 510)).toBe(0);
  });
});

describe("phonemizeKokoro (real eSpeak-ng via phonemizer)", () => {
  it("turns 'Hello world.' into IPA with stress and trailing punctuation", async () => {
    const out = await phonemizeKokoro("Hello world.", "a");
    expect(out.length).toBeGreaterThan(5);
    expect(out).toMatch(/[ˈˌ]/); // primary or secondary stress marker
    expect(out).toMatch(/\.$/); // trailing period preserved
  });

  it("post-processes r → ɹ (catches a regression in kokoroPostProcess wiring)", async () => {
    // 'rain' phonemizes to /ɹeɪn/ in en-us. eSpeak may emit 'r' or 'ɹ'
    // depending on voice; either way the post-process step must end in ɹ.
    const out = await phonemizeKokoro("rain", "a");
    expect(out).toContain("ɹ");
    expect(out).not.toContain("r"); // no plain ASCII r should survive
  });

  it("returns non-empty output (catches a silent phonemizer init failure)", async () => {
    const out = await phonemizeKokoro("test", "a");
    expect(out.trim().length).toBeGreaterThan(0);
  });

  it("produces different output for different dialects (en-us vs en-gb)", async () => {
    const us = await phonemizeKokoro("water", "a");
    const gb = await phonemizeKokoro("water", "b");
    expect(us).not.toBe(gb);
  });

  it("phonemizes only non-punctuation segments (commas/periods stay verbatim)", async () => {
    const out = await phonemizeKokoro("Hi, bye.", "a");
    // Punctuation passes through in order.
    expect(out).toMatch(/,/);
    expect(out).toMatch(/\.$/);
    // The input letters that AREN'T also valid IPA symbols (capital H, vowel
    // 'i', 'y', 'e') must not survive. Lowercase 'b' is in the IPA vocab so
    // we can't assert against it. If segment routing were inverted (words
    // passed verbatim, punctuation phonemized), 'H', 'i', 'y', 'e' would all
    // appear in the output.
    expect(out).not.toMatch(/[Hiye]/);
  });

  it("output is a string ready to feed tokenize() — every char is in the vocab", async () => {
    const out = await phonemizeKokoro("Hello world.", "a");
    const realVocab: Record<string, number> = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("./fixtures/tokenizer-vocab.json", import.meta.url)),
        "utf8",
      ),
    );
    const tok: Tokenizer = {
      vocab: realVocab,
      bos: realVocab.$ as number,
      eos: realVocab.$ as number,
      pad: realVocab.$ as number,
      unk: realVocab.$ as number,
    };
    const ids = tokenize(out, tok);
    // BOS + at least a few phoneme ids + EOS. If phonemes were empty, length === 2.
    expect(ids.length).toBeGreaterThan(6);
  });
});

describe("voice file layout (against real af_heart.bin fixture)", () => {
  const fixturePath = fileURLToPath(new URL("./fixtures/af_heart.bin", import.meta.url));
  const bytes = readFileSync(fixturePath);
  // Float32Array view over the underlying ArrayBuffer.
  const f32 = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT,
  );

  it("file size is a multiple of STYLE_DIM*4 (validates layout assumption)", () => {
    expect(bytes.byteLength % (STYLE_DIM * 4)).toBe(0);
  });

  it("voiceFileBuckets reports exactly 510 buckets", () => {
    expect(voiceFileBuckets(bytes.byteLength)).toBe(510);
  });

  it("every valid bucket index produces a 256-float slice within bounds", () => {
    const n = voiceFileBuckets(bytes.byteLength);
    for (const b of [0, 1, 14, 100, n - 1]) {
      const slice = sliceStyle(f32, b);
      expect(slice.length).toBe(STYLE_DIM);
      // No NaN/Infinity in real voice weights.
      expect(slice.every(Number.isFinite)).toBe(true);
      // Vectors should be non-trivial (not all zeros).
      expect(slice.some((x) => x !== 0)).toBe(true);
    }
  });

  it("sliceStyle throws when bucket would read past the end", () => {
    expect(() => sliceStyle(f32, 510)).toThrow(/out of bounds/);
  });

  it("styleBucket clamping keeps the slice in-bounds for any input length", () => {
    const n = voiceFileBuckets(bytes.byteLength);
    for (const len of [0, 1, 2, 3, 100, 1000, 100000]) {
      const b = styleBucket(len, n);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(n);
      // And the slice math must succeed.
      expect(() => sliceStyle(f32, b)).not.toThrow();
    }
  });

  it("buckets differ across positions (not a tiled identical vector)", () => {
    const a = sliceStyle(f32, 0);
    const b = sliceStyle(f32, 100);
    let diffs = 0;
    for (let i = 0; i < STYLE_DIM; i++) if (a[i] !== b[i]) diffs++;
    expect(diffs).toBeGreaterThan(STYLE_DIM / 2);
  });
});

describe("parseTokenizer", () => {
  const validTokJson = {
    model: { vocab: { $: 0, h: 50 } },
    post_processor: {
      single: [
        { SpecialToken: { id: "$" } },
        { Sequence: { id: "A" } },
        { SpecialToken: { id: "$" } },
      ],
    },
  };
  const validCfg = { pad_token: "$", unk_token: "$" };

  it("extracts vocab, BOS/EOS, pad, and unk from the Kokoro-shaped files", () => {
    const tok = parseTokenizer(validTokJson, validCfg);
    expect(tok.bos).toBe(0);
    expect(tok.eos).toBe(0);
    expect(tok.pad).toBe(0);
    expect(tok.unk).toBe(0);
    expect(tok.vocab.h).toBe(50);
  });

  it("throws when model.vocab is missing", () => {
    expect(() => parseTokenizer({ model: {} }, validCfg)).toThrow(/vocab/);
  });

  it("throws when BOS token is not in the vocab", () => {
    expect(() =>
      parseTokenizer(
        {
          model: { vocab: { h: 50 } },
          post_processor: {
            single: [{ SpecialToken: { id: "$" } }, { SpecialToken: { id: "$" } }],
          },
        },
        validCfg,
      ),
    ).toThrow(/BOS\/EOS/);
  });

  it("throws when pad_token is missing from vocab", () => {
    expect(() => parseTokenizer(validTokJson, { pad_token: "?", unk_token: "$" })).toThrow(
      /pad_token/,
    );
  });

  it("throws when unk_token is missing from vocab", () => {
    expect(() => parseTokenizer(validTokJson, { pad_token: "$", unk_token: "?" })).toThrow(
      /unk_token/,
    );
  });

  it("treats a single SpecialToken as both BOS and EOS", () => {
    const tok = parseTokenizer(
      {
        model: { vocab: { $: 0 } },
        post_processor: { single: [{ SpecialToken: { id: "$" } }] },
      },
      validCfg,
    );
    expect(tok.bos).toBe(0);
    expect(tok.eos).toBe(0);
  });
});
