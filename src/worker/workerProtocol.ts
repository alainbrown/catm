// Pure state machine for the worker message protocol. No browser APIs, no
// ORT — dependencies are injected so vitest (node env) can drive it.

import type { VoiceId } from "./types";

export type InMsg =
  | { type: "warmup" }
  | { type: "synth"; id: number; text: string; voice?: VoiceId }
  | { type: "synth-start"; txnId: number; voice?: VoiceId }
  | { type: "synth-chunk"; txnId: number; text: string }
  | { type: "synth-end"; txnId: number }
  | { type: "synth-cancel"; txnId: number };

export type LoadedDevice = "webgpu" | "wasm";

export interface DeviceInfo {
  device: LoadedDevice;
  // Best-effort adapter description. Empty strings when not available
  // (e.g. WASM path or browser hides the info for privacy).
  adapterName: string;
  adapterVendor: string;
  features: string[]; // e.g. ["shader-f16", "timestamp-query"]
  // Session init wall-clock time, measured once.
  sessionInitMs: number;
}

export type OutMsg =
  | { type: "ready"; device: LoadedDevice; info: DeviceInfo }
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
  | { type: "synth-end-ok"; txnId: number; wallMs: number; audioSec: number }
  | { type: "synth-cancelled"; txnId: number }
  | { type: "chunk-encoded"; txnId: number; durationSec: number; samples: number }
  | {
      type: "progress";
      status: string;
      file?: string | undefined;
      loaded?: number | undefined;
      total?: number | undefined;
    };

export interface Encoder {
  start(): void;
  pushChunk(pcm: Float32Array): Promise<void>;
  finish(): Promise<void>;
}

export interface WorkerDeps {
  load: () => Promise<DeviceInfo>;
  synthesizePcm: (text: string, voice: VoiceId) => Promise<Float32Array>;
  createEncoder: (
    sampleRate: number,
    onInit: (bytes: Uint8Array) => void,
    onSegment: (index: number, bytes: Uint8Array, durationSec: number) => void,
  ) => Encoder;
  post: (msg: OutMsg, transfer?: Transferable[]) => void;
  sampleRate: number;
  defaultVoice: VoiceId;
}

export interface ActiveStream {
  txnId: number;
  voice: VoiceId;
  encoder: Encoder;
  startMs: number;
  audioSec: number;
}

export interface Handlers {
  onMessage(msg: InMsg): void;
  // Exposed for tests: lets a test await all currently queued work without
  // poking workQueue directly.
  drain(): Promise<void>;
}

export function createHandlers(deps: WorkerDeps): Handlers {
  let stream: ActiveStream | null = null;
  // Cancelled txnIds — subsequent chunk/end messages drop silently.
  const cancelledTxnIds = new Set<number>();
  // Serialise async handling: Chrome dispatches the next message while a
  // previous handler is awaiting, which would let a chunk's `await` resume
  // after a later `synth-end` tore down the encoder.
  let workQueue: Promise<unknown> = Promise.resolve();

  function onMessage(msg: InMsg): void {
    // Cancel must be processed out-of-band — queueing it would defeat the
    // purpose (it'd sit behind every already-posted chunk).
    if (msg.type === "synth-cancel") {
      handleCancel(msg.txnId);
      return;
    }
    workQueue = workQueue.then(() => handle(msg));
  }

  function handleCancel(txnId: number): void {
    cancelledTxnIds.add(txnId);
    if (stream && stream.txnId === txnId) stream = null;
    deps.post({ type: "synth-cancelled", txnId });
  }

  async function handle(msg: InMsg): Promise<void> {
    try {
      if (msg.type === "warmup") {
        const info = await deps.load();
        deps.post({ type: "ready", device: info.device, info });
        return;
      }
      if (msg.type === "synth") {
        const voice = msg.voice ?? deps.defaultVoice;
        const pcm = await deps.synthesizePcm(msg.text, voice);
        deps.post({ type: "synth-result", id: msg.id, pcm, sampleRate: deps.sampleRate }, [
          pcm.buffer,
        ]);
        return;
      }
      if (msg.type === "synth-start") {
        await deps.load();
        const txnId = msg.txnId;
        cancelledTxnIds.delete(txnId);
        const voice = msg.voice ?? deps.defaultVoice;
        const encoder = deps.createEncoder(
          deps.sampleRate,
          (bytes) => deps.post({ type: "fragment-init", txnId, bytes }, [bytes.buffer]),
          (index, bytes, durationSec) =>
            deps.post({ type: "fragment-media", txnId, index, bytes, durationSec }, [bytes.buffer]),
        );
        encoder.start();
        stream = { txnId, voice, encoder, startMs: performance.now(), audioSec: 0 };
        return;
      }
      if (msg.type === "synth-chunk") {
        if (cancelledTxnIds.has(msg.txnId)) return;
        if (!stream || stream.txnId !== msg.txnId) throw new Error("no active synth stream");
        const pcm = await deps.synthesizePcm(msg.text, stream.voice);
        // Re-check: user may have cancelled while synthesizePcm awaited.
        if (cancelledTxnIds.has(msg.txnId)) return;
        await stream.encoder.pushChunk(pcm);
        const durationSec = pcm.length / deps.sampleRate;
        stream.audioSec += durationSec;
        deps.post({
          type: "chunk-encoded",
          txnId: msg.txnId,
          durationSec,
          samples: pcm.length,
        });
        return;
      }
      if (msg.type === "synth-end") {
        if (cancelledTxnIds.has(msg.txnId)) {
          cancelledTxnIds.delete(msg.txnId);
          return;
        }
        if (!stream || stream.txnId !== msg.txnId) throw new Error("no active synth stream");
        await stream.encoder.finish();
        const wallMs = performance.now() - stream.startMs;
        deps.post({
          type: "synth-end-ok",
          txnId: msg.txnId,
          wallMs,
          audioSec: stream.audioSec,
        });
        stream = null;
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errMsg: OutMsg = { type: "error", message };
      if ("id" in msg && typeof msg.id === "number") errMsg.id = msg.id;
      if ("txnId" in msg && typeof msg.txnId === "number") errMsg.txnId = msg.txnId;
      deps.post(errMsg);
      if ("txnId" in msg) stream = null;
    }
  }

  async function drain(): Promise<void> {
    await workQueue;
  }

  return { onMessage, drain };
}
