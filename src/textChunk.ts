export const CHUNK_CHARS = 500;

/**
 * Split text into chunks for progressive synthesis. Paragraphs (blank-line
 * separated) force a chunk boundary. Within a paragraph, sentences are
 * detected via `Intl.Segmenter` and packed greedily up to `maxChars`. A
 * single sentence longer than `maxChars` is hard-split at the nearest
 * whitespace.
 */
export function chunkText(text: string, maxChars: number): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });
  const chunks: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;
    const sentences = Array.from(segmenter.segment(trimmed), (s) => s.segment.trim()).filter(
      (s) => s.length > 0,
    );
    let buffer = "";
    for (const s of sentences) {
      if (s.length > maxChars) {
        if (buffer) {
          chunks.push(buffer);
          buffer = "";
        }
        for (const hard of hardSplit(s, maxChars)) chunks.push(hard);
        continue;
      }
      const sep = buffer ? " " : "";
      if (buffer.length + sep.length + s.length > maxChars) {
        chunks.push(buffer);
        buffer = "";
      }
      buffer += (buffer ? " " : "") + s;
    }
    if (buffer) chunks.push(buffer);
  }
  return chunks;
}

export interface ChunkRange {
  start: number;
  end: number;
}

/**
 * Locate where each trimmed chunk lives within the original source text.
 * Walks both strings in parallel, treating any run of whitespace as a single
 * separator. Tolerant of mismatches: if a character can't be aligned, the
 * source cursor advances until it finds the next match.
 *
 * Returns one range per chunk, in input order. Whitespace between chunks
 * belongs to neither the preceding nor the following chunk's range.
 */
export function locateChunks(source: string, chunks: string[]): ChunkRange[] {
  const out: ChunkRange[] = [];
  let i = 0;
  for (const chunk of chunks) {
    while (i < source.length && /\s/.test(source[i] as string)) i++;
    const start = i;
    let j = 0;
    let lastMatch = i;
    while (i < source.length && j < chunk.length) {
      const sc = source[i] as string;
      const cc = chunk[j] as string;
      if (sc === cc) {
        i++;
        j++;
        lastMatch = i;
      } else if (/\s/.test(sc) && /\s/.test(cc)) {
        i++;
        j++;
        lastMatch = i;
      } else if (/\s/.test(sc)) {
        i++;
      } else if (/\s/.test(cc)) {
        j++;
      } else {
        i++;
      }
    }
    out.push({ start, end: Math.max(start, lastMatch) });
  }
  return out;
}

function hardSplit(text: string, maxChars: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + maxChars, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > i + maxChars / 2) end = lastSpace;
    }
    const slice = text.slice(i, end).trim();
    if (slice) out.push(slice);
    i = end;
  }
  return out;
}
