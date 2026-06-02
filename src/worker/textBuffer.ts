// Read-ahead buffer that turns the input text into synthesis chunks, following
// Kokoro-FastAPI's smart_split strategy: split into whole sentences, then group
// them toward a token target and sub-split any over-long sentence, so every
// emitted chunk stays under Kokoro's 510-token input cap (nothing truncates).
// Token counting is injected (phonemize + tokenize).

// Defaults from Kokoro-FastAPI (target_min/target_max/absolute_max), all below
// the 510-token cap so generation never truncates.
const TARGET_MIN_TOKENS = 175;
const TARGET_MAX_TOKENS = 250;
const ABSOLUTE_MAX_TOKENS = 450;

export interface TextBufferDeps {
  measure: (text: string) => Promise<number>;
}

export interface TextBufferOptions {
  targetMinTokens?: number;
  targetMaxTokens?: number;
  absoluteMaxTokens?: number;
}

export class TextBuffer {
  private readonly sentences: string[];
  private readonly measure: (text: string) => Promise<number>;
  private readonly targetMin: number;
  private readonly targetMax: number;
  private readonly absoluteMax: number;
  private index = 0;
  private queue: string[] = [];

  constructor(text: string, deps: TextBufferDeps, opts: TextBufferOptions = {}) {
    this.measure = deps.measure;
    this.targetMin = opts.targetMinTokens ?? TARGET_MIN_TOKENS;
    this.targetMax = opts.targetMaxTokens ?? TARGET_MAX_TOKENS;
    this.absoluteMax = opts.absoluteMaxTokens ?? ABSOLUTE_MAX_TOKENS;
    this.sentences = splitSentences(text);
  }

  hasNext(): boolean {
    return this.queue.length > 0 || this.index < this.sentences.length;
  }

  // Returns the next chunk, or null once all sentences are consumed.
  async next(): Promise<string | null> {
    if (this.queue.length === 0) await this.buildChunks();
    return this.queue.shift() ?? null;
  }

  // Group sentences toward the token target until at least one chunk is ready.
  private async buildChunks(): Promise<void> {
    let chunk = "";
    let tokens = 0;
    while (this.index < this.sentences.length) {
      const sentence = this.sentences[this.index] as string;
      const count = await this.measure(sentence);

      // A single sentence over the hard cap: flush the current chunk, then
      // sub-split this one on commas (then whitespace) so no piece truncates.
      if (count > this.absoluteMax) {
        this.index++;
        if (chunk) this.queue.push(chunk);
        for (const piece of await this.splitOverlong(sentence)) this.queue.push(piece);
        return;
      }

      if (chunk === "") {
        chunk = sentence;
        tokens = count;
        this.index++;
      } else if (tokens + count <= this.targetMax) {
        chunk = `${chunk} ${sentence}`;
        tokens += count;
        this.index++;
      } else if (tokens < this.targetMin && tokens + count <= this.absoluteMax) {
        // Under the minimum: keep filling past target_max, up to the hard cap.
        chunk = `${chunk} ${sentence}`;
        tokens += count;
        this.index++;
      } else {
        break; // chunk is full enough; emit it and start fresh next time
      }
    }
    if (chunk) this.queue.push(chunk);
  }

  // Split a sentence that exceeds the hard cap: greedily pack comma clauses,
  // falling back to whitespace splitting for any clause still too large.
  private async splitOverlong(sentence: string): Promise<string[]> {
    const out: string[] = [];
    let buf = "";
    let bufTokens = 0;
    for (const clause of sentence.split(/(?<=,)/)) {
      const count = await this.measure(clause);
      if (count > this.absoluteMax) {
        if (buf) {
          out.push(buf);
          buf = "";
          bufTokens = 0;
        }
        for (const piece of await splitToFit(clause, this.absoluteMax, this.measure))
          out.push(piece);
        continue;
      }
      if (buf === "") {
        buf = clause;
        bufTokens = count;
      } else if (bufTokens + count <= this.absoluteMax) {
        buf += clause;
        bufTokens += count;
      } else {
        out.push(buf);
        buf = clause;
        bufTokens = count;
      }
    }
    if (buf) out.push(buf.trim());
    return out.map((p) => p.trim()).filter((p) => p.length > 0);
  }
}

// Split into whole sentences on sentence punctuation followed by whitespace or
// end-of-string — deliberately NOT on newlines, so a hard-wrapped line doesn't
// cut a sentence in half. Whitespace is collapsed first so wraps become spaces.
// (Pattern from Kokoro-FastAPI's get_sentence_info.)
function splitSentences(text: string): string[] {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return [];
  const parts = collapsed.split(/([.!?;:])(?=\s|$)/);
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const punct = parts[i + 1] ?? "";
    const sentence = `${body}${punct}`.trim();
    if (sentence.length > 0) sentences.push(sentence);
  }
  return sentences;
}

// Recursively split at the first whitespace from the midpoint until every piece
// fits maxTokens. A piece with no splittable whitespace is returned as-is.
async function splitToFit(
  text: string,
  maxTokens: number,
  measure: (text: string) => Promise<number>,
): Promise<string[]> {
  if ((await measure(text)) <= maxTokens) return [text];
  const mid = Math.floor(text.length / 2);
  let splitAt = -1;
  for (let i = mid; i < text.length; i++) {
    if (/\s/.test(text[i] as string)) {
      splitAt = i;
      break;
    }
  }
  if (splitAt === -1) return [text];
  const [l, r] = await Promise.all([
    splitToFit(text.slice(0, splitAt), maxTokens, measure),
    splitToFit(text.slice(splitAt), maxTokens, measure),
  ]);
  return [...l, ...r];
}
