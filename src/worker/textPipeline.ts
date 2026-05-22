// Pipeline helpers for Kokoro. No browser APIs, no ORT — extracted so vitest
// (node env) can test them. `phonemizer` is in-process WASM and works in node.

import { phonemize } from "phonemizer";

export interface Tokenizer {
  vocab: Record<string, number>;
  bos: number;
  eos: number;
  pad: number;
  unk: number;
}

export interface Segment {
  match: boolean; // true → punctuation chunk, passed through verbatim
  text: string;
}

// ─── normalization helpers (ported from kokoro-js/dist/kokoro.js) ───────────
export function expandNumberToken(token: string): string {
  if (token.includes(".")) return token;
  if (token.includes(":")) {
    const [h, m] = token.split(":").map(Number);
    if (m === undefined) return token;
    if (m === 0) return `${h} o'clock`;
    if (m < 10) return `${h} oh ${m}`;
    return `${h} ${m}`;
  }
  const year = Number.parseInt(token.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return token;
  const upper = token.slice(0, 2);
  const lower = Number.parseInt(token.slice(2, 4), 10);
  const suffix = token.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (lower === 0) return `${upper} hundred${suffix}`;
    if (lower < 10) return `${upper} oh ${lower}${suffix}`;
  }
  return `${upper} ${lower}${suffix}`;
}

export function expandMoney(token: string): string {
  const currency = token[0] === "$" ? "dollar" : "pound";
  if (Number.isNaN(Number(token.slice(1)))) return `${token.slice(1)} ${currency}s`;
  if (!token.includes(".")) {
    const plural = token.slice(1) === "1" ? "" : "s";
    return `${token.slice(1)} ${currency}${plural}`;
  }
  const [whole, frac] = token.slice(1).split(".");
  const cents = Number.parseInt((frac ?? "").padEnd(2, "0"), 10);
  const wholePlural = whole === "1" ? "" : "s";
  const fracWord =
    token[0] === "$" ? (cents === 1 ? "cent" : "cents") : cents === 1 ? "penny" : "pence";
  return `${whole} ${currency}${wholePlural} and ${cents} ${fracWord}`;
}

export function expandDecimal(token: string): string {
  const [w, f] = token.split(".");
  return `${w} point ${(f ?? "").split("").join(" ")}`;
}

export function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, "“")
    .replace(/»/g, "”")
    .replace(/[“”]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/、/g, ", ")
    .replace(/。/g, ". ")
    .replace(/！/g, "! ")
    .replace(/，/g, ", ")
    .replace(/：/g, ": ")
    .replace(/；/g, "; ")
    .replace(/？/g, "? ")
    .replace(/[^\S \n]/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/(?<=\n) +(?=\n)/g, "")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, expandNumberToken)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(
      /[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
      expandMoney,
    )
    .replace(/\d*\.\d+/g, expandDecimal)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (m) => m.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

// ─── punctuation splitting ──────────────────────────────────────────────────
const PUNCT_SPLIT_RE = new RegExp(
  `(\\s*[${';:,.!?¡¿—…"«»“”(){}\\[\\]'.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}]+\\s*)+`,
  "g",
);

export function splitForPhonemization(normalized: string): Segment[] {
  const out: Segment[] = [];
  let cursor = 0;
  for (const m of normalized.matchAll(PUNCT_SPLIT_RE)) {
    const matchText = m[0];
    if (matchText === undefined) continue;
    if (cursor < m.index) out.push({ match: false, text: normalized.slice(cursor, m.index) });
    if (matchText.length > 0) out.push({ match: true, text: matchText });
    cursor = m.index + matchText.length;
  }
  if (cursor < normalized.length) out.push({ match: false, text: normalized.slice(cursor) });
  return out;
}

// Full text-to-phonemes pipeline: normalize → split → phonemize → post-process.
// `dialect`: "a" → en-us (default), "b" → en-gb.
export async function phonemizeKokoro(text: string, dialect: "a" | "b" = "a"): Promise<string> {
  const normalized = normalizeText(text);
  const lang = dialect === "a" ? "en-us" : "en";
  const segments = splitForPhonemization(normalized);
  const phonemizedParts = await Promise.all(
    segments.map(async (s) => (s.match ? s.text : (await phonemize(s.text, lang)).join(" "))),
  );
  return kokoroPostProcess(phonemizedParts.join(""), dialect);
}

// ─── post-phonemization fix-ups (Kokoro-specific) ───────────────────────────
export function kokoroPostProcess(phonemes: string, dialect: "a" | "b" = "a"): string {
  let out = phonemes
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (dialect === "a") out = out.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return out.trim();
}

// ─── tokenization ───────────────────────────────────────────────────────────
// Characters not in the vocab map to the unk_token id (from tokenizer_config.json).
// This matches the HuggingFace tokenizer contract: every input position produces
// a token id, never silently disappears.
export function tokenize(phonemes: string, tok: Tokenizer): BigInt64Array {
  const ids: number[] = [tok.bos];
  for (const ch of phonemes) {
    const id = tok.vocab[ch];
    ids.push(id ?? tok.unk);
  }
  ids.push(tok.eos);
  return BigInt64Array.from(ids, (n) => BigInt(n));
}

// ─── voice file layout ──────────────────────────────────────────────────────
// Voice .bin files are flat fp32 arrays laid out as `buckets × STYLE_DIM`. The
// bucket index for an input is the unwrapped token count (input_ids.length
// excluding BOS+EOS), clamped to [0, buckets-1].
export const STYLE_DIM = 256;

export function voiceFileBuckets(byteLength: number): number {
  if (byteLength % (STYLE_DIM * 4) !== 0) {
    throw new Error(
      `voice file length ${byteLength} is not a multiple of STYLE_DIM*4 (${STYLE_DIM * 4})`,
    );
  }
  return byteLength / (STYLE_DIM * 4);
}

export function styleBucket(inputIdsLength: number, maxBuckets: number): number {
  return Math.min(Math.max(inputIdsLength - 2, 0), maxBuckets - 1);
}

export function sliceStyle(voice: Float32Array, bucket: number): Float32Array {
  if (bucket < 0 || (bucket + 1) * STYLE_DIM > voice.length) {
    throw new Error(
      `bucket ${bucket} out of bounds for voice of ${voice.length / STYLE_DIM} buckets`,
    );
  }
  return voice.slice(bucket * STYLE_DIM, (bucket + 1) * STYLE_DIM);
}

// ─── tokenizer parser ───────────────────────────────────────────────────────
// Takes the parsed contents of tokenizer.json AND tokenizer_config.json from
// the model repo. The first supplies the vocab and BOS/EOS template; the
// second supplies the pad_token and unk_token strings.
export function parseTokenizer(tokenizerJson: unknown, tokenizerConfigJson: unknown): Tokenizer {
  const tj = tokenizerJson as {
    model?: { vocab?: Record<string, number> };
    post_processor?: { single?: Array<{ SpecialToken?: { id?: string } }> };
  };
  const vocab = tj.model?.vocab;
  if (!vocab || typeof vocab !== "object") {
    throw new Error("tokenizer.json: missing model.vocab");
  }
  const single = tj.post_processor?.single;
  const specials =
    single?.map((s) => s.SpecialToken?.id).filter((id): id is string => typeof id === "string") ??
    [];
  const bosTok = specials[0];
  const eosTok = specials[specials.length - 1] ?? bosTok;
  if (!bosTok || !(bosTok in vocab) || !eosTok || !(eosTok in vocab)) {
    throw new Error("tokenizer.json: could not resolve BOS/EOS tokens");
  }

  const cfg = tokenizerConfigJson as { pad_token?: string; unk_token?: string };
  const padTok = cfg.pad_token;
  const unkTok = cfg.unk_token;
  if (!padTok || !(padTok in vocab)) {
    throw new Error(`tokenizer_config.json: pad_token "${padTok}" not in vocab`);
  }
  if (!unkTok || !(unkTok in vocab)) {
    throw new Error(`tokenizer_config.json: unk_token "${unkTok}" not in vocab`);
  }

  return {
    vocab,
    bos: vocab[bosTok] as number,
    eos: vocab[eosTok] as number,
    pad: vocab[padTok] as number,
    unk: vocab[unkTok] as number,
  };
}
