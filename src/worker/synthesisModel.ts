import { KokoroTTS } from "kokoro-js";
import type { VoiceId } from "./types";

export interface SynthesisClient {
  ensureLoaded(): Promise<void>;
  synthesize(text: string, voice: VoiceId): Promise<Float32Array>;
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
}
