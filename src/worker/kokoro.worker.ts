/// <reference lib="webworker" />
import { KokoroTTS } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE = "af_heart";

type LoadedDevice = "webgpu" | "wasm";

interface Loaded {
  tts: KokoroTTS;
  device: LoadedDevice;
  sampleRate: number;
}

let loaded: Promise<Loaded> | null = null;

async function tryLoad(device: LoadedDevice, dtype: "fp32" | "q8"): Promise<KokoroTTS> {
  return KokoroTTS.from_pretrained(MODEL_ID, { dtype, device });
}

interface AdapterRequester {
  requestAdapter: () => Promise<unknown>;
}
async function hasUsableWebGPU(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: AdapterRequester }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

function load(): Promise<Loaded> {
  if (loaded) return loaded;
  loaded = (async () => {
    if (await hasUsableWebGPU()) {
      try {
        const tts = await tryLoad("webgpu", "fp32");
        return { tts, device: "webgpu", sampleRate: 24000 };
      } catch (err) {
        console.warn("[kokoro] WebGPU load failed, falling back to WASM", err);
      }
    }
    const tts = await tryLoad("wasm", "q8");
    return { tts, device: "wasm", sampleRate: 24000 };
  })();
  return loaded;
}

type InMsg = { type: "warmup" } | { type: "synth"; id: number; text: string };

type OutMsg =
  | { type: "ready"; device: LoadedDevice }
  | { type: "error"; id?: number; message: string }
  | { type: "synth-result"; id: number; pcm: Float32Array; sampleRate: number };

self.addEventListener("message", async (ev: MessageEvent<InMsg>) => {
  const msg = ev.data;
  try {
    if (msg.type === "warmup") {
      const { device } = await load();
      post({ type: "ready", device });
      return;
    }
    if (msg.type === "synth") {
      const { tts } = await load();
      const audio = await tts.generate(msg.text, { voice: VOICE });
      // RawAudio: .audio (Float32Array), .sampling_rate (number)
      const pcm = audio.audio as Float32Array;
      const sampleRate = audio.sampling_rate as number;
      post({ type: "synth-result", id: msg.id, pcm, sampleRate }, [pcm.buffer]);
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: "error", id: "id" in msg ? msg.id : undefined, message });
  }
});

function post(msg: OutMsg, transfer: Transferable[] = []): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

export type { InMsg, OutMsg };
