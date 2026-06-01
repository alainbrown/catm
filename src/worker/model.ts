import { KokoroTTS } from "kokoro-js";
import { phonemize } from "phonemizer";
import type { VoiceId } from "./types";

export type ProgressEvent = {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
};

export type ModelConfig = {
  model?: string;
  device?: "webgpu" | "wasm";
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  onProgress?: (event: ProgressEvent) => void;
};

const DEFAULT_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

type GenerateVoice = Parameters<KokoroTTS["generate"]>[1] extends infer O
  ? O extends { voice?: infer V }
    ? V
    : never
  : never;

export class KokoroModel {
  private tts: KokoroTTS | null = null;
  private readonly model: string;
  private readonly device: "webgpu" | "wasm";
  private readonly dtype: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  private readonly onProgress?: (event: ProgressEvent) => void;

  constructor(config: ModelConfig = {}) {
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

  async generate(text: string, voice: VoiceId): Promise<Float32Array> {
    await this.ensureLoaded();
    if (!this.tts) throw new Error("synthesis: pipeline not initialized");
    const result = await this.tts.generate(text, { voice: voice as GenerateVoice });
    return result.audio;
  }

  // Phoneme-token count for a string, used to keep pieces under Kokoro's cap.
  makeMeasure(voice: VoiceId): (s: string) => Promise<number> {
    const lang = voice.charAt(0) === "a" ? "en-us" : "en";
    return async (s: string): Promise<number> => {
      await this.ensureLoaded();
      if (!this.tts) throw new Error("synthesis: pipeline not initialized");
      const phonemes = (await phonemize(s, lang)).join(" ");
      const { input_ids } = this.tts.tokenizer(phonemes, { truncation: false });
      return input_ids.dims.at(-1) as number;
    };
  }
}
