export type View = "reader";

export type AppStatus =
  | { kind: "loading" } // worker booting / preparing — model not yet downloading
  | { kind: "downloading"; loadedMb: number; totalMb: number; fraction: number }
  | { kind: "ready"; device: "webgpu" | "wasm" }
  | { kind: "synthesising" }
  | { kind: "error"; message: string };

import type { VoiceId } from "./worker/kokoro.worker";

export interface DocState {
  id: string | null; // null = unsaved new document
  sourceText: string;
  savedText: string;
  hasAudio: boolean; // when true, ReaderView attaches hls.js to this session's id
  audioVoice: VoiceId | null; // voice the saved audio was recorded with
}
