import { TextSplitterStream } from "kokoro-js";

// Wraps kokoro-js's TextSplitterStream as a (text) => sentences function.
export type SplitSentences = (text: string) => string[];

export const splitSentences: SplitSentences = (text) => {
  const splitter = new TextSplitterStream();
  splitter.push(text);
  splitter.close();
  return [...splitter];
};
