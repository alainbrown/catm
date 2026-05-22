/// <reference lib="webworker" />
import { KokoroTTS } from "kokoro-js";
import { ProgressiveEncoder } from "../hls/encode";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DEFAULT_VOICE = "af_heart";

export type VoiceId = "af_heart" | "af_bella" | "am_michael" | "am_eric";

type LoadedDevice = "webgpu" | "wasm";

interface Loaded {
  tts: KokoroTTS;
  device: LoadedDevice;
  sampleRate: number;
}

let loaded: Promise<Loaded> | null = null;

async function tryLoad(
  device: LoadedDevice,
  dtype: "fp32" | "q8",
  progress_callback?: (ev: ProgressEventRaw) => void,
): Promise<KokoroTTS> {
  return KokoroTTS.from_pretrained(MODEL_ID, { dtype, device, progress_callback });
}

interface ProgressEventRaw {
  status: string;
  file?: string;
  name?: string;
  loaded?: number;
  total?: number;
  progress?: number;
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
    const cb = (ev: ProgressEventRaw): void => {
      post({
        type: "progress",
        status: ev.status,
        file: ev.file,
        loaded: ev.loaded,
        total: ev.total,
      });
    };
    if (await hasUsableWebGPU()) {
      try {
        const tts = await tryLoad("webgpu", "fp32", cb);
        return { tts, device: "webgpu", sampleRate: 24000 };
      } catch (err) {
        console.warn("[kokoro] WebGPU load failed, falling back to WASM", err);
      }
    }
    const tts = await tryLoad("wasm", "q8", cb);
    return { tts, device: "wasm", sampleRate: 24000 };
  })();
  return loaded;
}

type InMsg =
  | { type: "warmup" }
  | { type: "synth"; id: number; text: string; voice?: VoiceId }
  | { type: "synth-start"; txnId: number; voice?: VoiceId }
  | { type: "synth-chunk"; txnId: number; text: string }
  | { type: "synth-end"; txnId: number }
  | { type: "synth-cancel"; txnId: number };

type OutMsg =
  | { type: "ready"; device: LoadedDevice }
  | { type: "error"; id?: number; txnId?: number; message: string }
  | { type: "synth-result"; id: number; pcm: Float32Array; sampleRate: number }
  | { type: "fragment-init"; txnId: number; bytes: Uint8Array }
  | {
      type: "fragment-media";
      txnId: number;
      index: number;
      bytes: Uint8Array;
      durationSec: number;
    }
  | { type: "synth-end-ok"; txnId: number }
  | { type: "synth-cancelled"; txnId: number }
  | { type: "chunk-encoded"; txnId: number; durationSec: number }
  | {
      type: "progress";
      status: string;
      file?: string | undefined;
      loaded?: number | undefined;
      total?: number | undefined;
    };

interface ActiveStream {
  txnId: number;
  voice: VoiceId;
  encoder: ProgressiveEncoder;
}

let stream: ActiveStream | null = null;
// txnIds that have been cancelled. Subsequent chunk/end messages for these
// are dropped silently (the user-facing teardown already happened).
const cancelledTxnIds = new Set<number>();

// Serialise message handling. Chrome dispatches the next message while a
// previous handler is awaiting, which would let a chunk's `await` resume
// after a later `synth-end` tore down the encoder. Chain all work onto a
// single promise so each message completes before the next starts.
let workQueue: Promise<unknown> = Promise.resolve();

self.addEventListener("message", (ev: MessageEvent<InMsg>) => {
  // Cancel must be processed out-of-band: if we queued it, it would sit
  // behind every already-posted synth-chunk and only run after the entire
  // synthesis finished — which defeats the point of a cancel button.
  if (ev.data.type === "synth-cancel") {
    handleCancel(ev.data.txnId);
    return;
  }
  workQueue = workQueue.then(() => handle(ev.data));
});

function handleCancel(txnId: number): void {
  cancelledTxnIds.add(txnId);
  if (stream && stream.txnId === txnId) {
    // Drop the encoder reference synchronously so any queued chunk handler
    // that wakes up sees no active stream for this txn. The encoder itself
    // will be garbage-collected; we don't await finish() because that would
    // emit a final fragment we'd have to discard anyway.
    stream = null;
  }
  post({ type: "synth-cancelled", txnId });
}

async function handle(msg: InMsg): Promise<void> {
  try {
    if (msg.type === "warmup") {
      const { device } = await load();
      post({ type: "ready", device });
      return;
    }
    if (msg.type === "synth") {
      const { tts } = await load();
      const voice = msg.voice ?? DEFAULT_VOICE;
      const audio = await tts.generate(msg.text, { voice });
      const pcm = audio.audio as Float32Array;
      const sampleRate = audio.sampling_rate as number;
      post({ type: "synth-result", id: msg.id, pcm, sampleRate }, [pcm.buffer]);
      return;
    }
    if (msg.type === "synth-start") {
      const { sampleRate } = await load();
      const txnId = msg.txnId;
      cancelledTxnIds.delete(txnId);
      const voice = msg.voice ?? DEFAULT_VOICE;
      const encoder = new ProgressiveEncoder(
        sampleRate,
        (bytes) => post({ type: "fragment-init", txnId, bytes }, [bytes.buffer]),
        (index, bytes, durationSec) =>
          post({ type: "fragment-media", txnId, index, bytes, durationSec }, [bytes.buffer]),
      );
      encoder.start();
      stream = { txnId, voice, encoder };
      return;
    }
    if (msg.type === "synth-chunk") {
      if (cancelledTxnIds.has(msg.txnId)) return;
      if (!stream || stream.txnId !== msg.txnId) {
        throw new Error("no active synth stream");
      }
      const { tts } = await load();
      const audio = await tts.generate(msg.text, { voice: stream.voice });
      // The user may have cancelled while tts.generate was running. Drop the
      // result rather than pushing it into a torn-down encoder.
      if (cancelledTxnIds.has(msg.txnId)) return;
      const pcm = audio.audio as Float32Array;
      const sourceSampleRate = (await load()).sampleRate;
      await stream.encoder.pushChunk(pcm);
      post({
        type: "chunk-encoded",
        txnId: msg.txnId,
        durationSec: pcm.length / sourceSampleRate,
      });
      return;
    }
    if (msg.type === "synth-end") {
      if (cancelledTxnIds.has(msg.txnId)) {
        cancelledTxnIds.delete(msg.txnId);
        return;
      }
      if (!stream || stream.txnId !== msg.txnId) {
        throw new Error("no active synth stream");
      }
      await stream.encoder.finish();
      post({ type: "synth-end-ok", txnId: msg.txnId });
      stream = null;
      return;
    }
    // synth-cancel is handled synchronously in the top-level listener and
    // never reaches this queue.
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errMsg: OutMsg = { type: "error", message };
    if ("id" in msg && typeof msg.id === "number") errMsg.id = msg.id;
    if ("txnId" in msg && typeof msg.txnId === "number") errMsg.txnId = msg.txnId;
    post(errMsg);
    if ("txnId" in msg) stream = null;
  }
}

function post(msg: OutMsg, transfer: Transferable[] = []): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

export type { InMsg, OutMsg };
