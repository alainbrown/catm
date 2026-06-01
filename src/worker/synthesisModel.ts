import { KokoroTTS } from "kokoro-js";
import { phonemize } from "phonemizer";
import { splitSentences } from "./sentenceSplitter";
import { TextBuffer } from "./textBuffer";
import type { VoiceId } from "./types";

export interface SynthesisSentence {
  text: string;
  pcm: Float32Array;
}

export interface SynthesisClient {
  ensureLoaded(): Promise<void>;
  synthesize(text: string, voice: VoiceId): Promise<Float32Array>;
  stream(
    text: string,
    voice: VoiceId,
    onSentence: (s: SynthesisSentence) => Promise<void>,
    isCancelled: () => boolean,
  ): Promise<void>;
  sampleRate(): number;
}

export type ProgressEvent = {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
};

export type SynthesisClientConfig = {
  model?: string;
  device?: "webgpu" | "wasm";
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  onProgress?: (event: ProgressEvent) => void;
};

const DEFAULT_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

export class KokoroSynthesisClient implements SynthesisClient {
  private tts: KokoroTTS | null = null;
  private rate = 24000;
  private readonly model: string;
  private readonly device: "webgpu" | "wasm";
  private readonly dtype: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  private readonly onProgress?: (event: ProgressEvent) => void;

  constructor(config: SynthesisClientConfig = {}) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.device = config.device ?? "webgpu";
    this.dtype = config.dtype ?? "fp32";
    this.onProgress = config.onProgress;
  }

  async ensureLoaded(): Promise<void> {
    if (this.tts) return;
    this.tts = await KokoroTTS.from_pretrained(this.model, {
      dtype: this.dtype,
      device: this.device,
      progress_callback: this.onProgress,
    });
  }

  sampleRate(): number {
    return this.rate;
  }

  async synthesize(text: string, voice: VoiceId): Promise<Float32Array> {
    await this.ensureLoaded();
    if (!this.tts) throw new Error("synthesis: pipeline not initialized");
    const result = await this.tts.generate(text, {
      voice: voice as Parameters<KokoroTTS["generate"]>[1] extends infer O
        ? O extends { voice?: infer V }
          ? V
          : never
        : never,
    });
    this.rate = result.sampling_rate;
    return result.audio;
  }

  async stream(
    text: string,
    voice: VoiceId,
    onSentence: (s: SynthesisSentence) => Promise<void>,
    isCancelled: () => boolean,
  ): Promise<void> {
    await this.ensureLoaded();
    if (!this.tts) throw new Error("synthesis: pipeline not initialized");
    const tts = this.tts;
    // Phonemizer takes "en-us" / "en"; kokoro picks by voice first char.
    const lang = voice.charAt(0) === "a" ? "en-us" : "en";
    const measure = async (s: string): Promise<number> => {
      const phonemes = (await phonemize(s, lang)).join(" ");
      const { input_ids } = tts.tokenizer(phonemes, { truncation: false });
      return input_ids.dims.at(-1) as number;
    };
    const genOpts = {
      voice: voice as Parameters<KokoroTTS["generate"]>[1] extends infer O
        ? O extends { voice?: infer V }
          ? V
          : never
        : never,
    };
    const buffer = new TextBuffer(text, { splitSentences, measure });
    while (buffer.hasNext()) {
      if (isCancelled()) return;
      const piece = await buffer.next();
      if (piece === null) break;
      if (isCancelled()) return;
      const result = await tts.generate(piece, genOpts);
      this.rate = result.sampling_rate;
      await onSentence({ text: piece, pcm: result.audio });
    }
  }
}
