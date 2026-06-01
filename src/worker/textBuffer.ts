// Read-ahead buffer over the input text. Refills its queue by segmenting the
// next bounded slice only when drained, so it never segments the whole text at
// once. Segmentation and token measurement are injected.

const DEFAULT_BATCH_CHARS = 2000;
const DEFAULT_MAX_TOKENS = 480;

export interface TextBufferDeps {
  splitSentences: (text: string) => string[];
  measure: (text: string) => Promise<number>;
}

export interface TextBufferOptions {
  maxTokens?: number;
  batchChars?: number;
}

export class TextBuffer {
  private readonly text: string;
  private readonly splitSentences: (text: string) => string[];
  private readonly measure: (text: string) => Promise<number>;
  private readonly maxTokens: number;
  private readonly batchChars: number;
  private cursor = 0;
  private queue: string[] = [];

  constructor(text: string, deps: TextBufferDeps, opts: TextBufferOptions = {}) {
    this.text = text;
    this.splitSentences = deps.splitSentences;
    this.measure = deps.measure;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.batchChars = opts.batchChars ?? DEFAULT_BATCH_CHARS;
  }

  hasNext(): boolean {
    return this.queue.length > 0 || this.cursor < this.text.length;
  }

  // Returns null once the text is fully consumed.
  async next(): Promise<string | null> {
    if (this.queue.length === 0) await this.refill();
    return this.queue.shift() ?? null;
  }

  private async refill(): Promise<void> {
    while (this.queue.length === 0 && this.cursor < this.text.length) {
      const slice = this.takeSlice();
      for (const sentence of this.splitSentences(slice)) {
        const pieces = await splitToFit(sentence, this.maxTokens, this.measure);
        for (const piece of pieces) this.queue.push(piece);
      }
    }
  }

  // ~batchChars of text, extended to the next newline so slices end at a line
  // boundary (newlines are already sentence terminators).
  private takeSlice(): string {
    const start = this.cursor;
    let end = Math.min(start + this.batchChars, this.text.length);
    if (end < this.text.length) {
      const nl = this.text.indexOf("\n", end);
      end = nl === -1 ? this.text.length : nl + 1;
    }
    this.cursor = end;
    return this.text.slice(start, end);
  }
}

/**
 * Recursively split `text` until every returned piece measures within
 * `maxTokens`. Splits at the first whitespace at or after the string's
 * midpoint; the whitespace stays with the right piece so concatenating the
 * result reproduces the original text exactly.
 *
 * If a piece exceeds `maxTokens` but contains no whitespace from its midpoint
 * onward (a single word longer than the limit), it is returned as-is — there
 * is nothing to split on, and downstream synthesis must handle it.
 */
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
  const left = text.slice(0, splitAt);
  const right = text.slice(splitAt);
  const [l, r] = await Promise.all([
    splitToFit(left, maxTokens, measure),
    splitToFit(right, maxTokens, measure),
  ]);
  return [...l, ...r];
}
