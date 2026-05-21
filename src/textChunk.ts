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
