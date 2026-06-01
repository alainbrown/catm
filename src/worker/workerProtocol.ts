// Pure state machine for the worker message protocol. No browser APIs, no
// ORT — dependencies are injected so vitest (node env) can drive it.

import type { VoiceId } from "./types";

export type InMsg<V extends string = VoiceId> =
  | { type: "warmup" }
  | { type: "synth"; id: number; text: string; voice?: V }
  | { type: "synth-start"; txnId: number; sessionId: string; voice?: V }
  | { type: "synth-text"; txnId: number; text: string }
  | { type: "synth-end"; txnId: number }
  | { type: "synth-cancel"; txnId: number };

export type LoadedDevice = "webgpu" | "wasm";

export interface DeviceInfo {
  device: LoadedDevice;
  adapterName: string;
  adapterVendor: string;
  features: string[];
  sessionInitMs: number;
}

export type OutMsg =
  | { type: "ready"; device: LoadedDevice; info: DeviceInfo }
  | { type: "error"; id?: number; txnId?: number; message: string }
  | { type: "synth-result"; id: number; pcm: Float32Array; sampleRate: number }
  // The AudioBuffer writes HLS to OPFS itself; main only needs the cue to mount
  // the player once enough is buffered.
  | { type: "playback-ready"; txnId: number; sessionId: string }
  | { type: "synth-end-ok"; txnId: number; wallMs: number; audioSec: number }
  | { type: "synth-cancelled"; txnId: number }
  | { type: "chunk-encoded"; txnId: number; text: string; durationSec: number; samples: number }
  | {
      type: "progress";
      status: string;
      file?: string | undefined;
      loaded?: number | undefined;
      total?: number | undefined;
    };

// Owns both buffers for one synthesis: pull text in, push audio (HLS) out.
export interface Orchestrator<V extends string = VoiceId> {
  start(txnId: number, sessionId: string, voice: V): Promise<void>;
  feed(text: string, isCancelled: () => boolean): Promise<void>;
  finish(): Promise<{ audioSec: number }>;
}

export interface WorkerDeps<V extends string = VoiceId> {
  load: () => Promise<DeviceInfo>;
  synthesizePcm: (text: string, voice: V) => Promise<Float32Array>;
  createOrchestrator: () => Orchestrator<V>;
  post: (msg: OutMsg, transfer?: Transferable[]) => void;
  sampleRate: number;
  defaultVoice: V;
}

interface Active<V extends string> {
  txnId: number;
  orchestrator: Orchestrator<V>;
  startMs: number;
}

export interface Handlers<V extends string = VoiceId> {
  onMessage(msg: InMsg<V>): void;
  drain(): Promise<void>;
}

export function createHandlers<V extends string = VoiceId>(deps: WorkerDeps<V>): Handlers<V> {
  let active: Active<V> | null = null;
  const cancelledTxnIds = new Set<number>();
  const erroredTxnIds = new Set<number>();
  // Serialise async handling: Chrome dispatches the next message while a
  // previous handler awaits.
  let workQueue: Promise<unknown> = Promise.resolve();

  function onMessage(msg: InMsg<V>): void {
    // Cancel must be processed out-of-band — queueing it would defeat the
    // purpose (it'd sit behind the work it's trying to abort).
    if (msg.type === "synth-cancel") {
      handleCancel(msg.txnId);
      return;
    }
    workQueue = workQueue.then(() => handle(msg));
  }

  function handleCancel(txnId: number): void {
    cancelledTxnIds.add(txnId);
    if (active && active.txnId === txnId) active = null;
    deps.post({ type: "synth-cancelled", txnId });
  }

  async function handle(msg: InMsg<V>): Promise<void> {
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
        cancelledTxnIds.delete(msg.txnId);
        erroredTxnIds.delete(msg.txnId);
        const orchestrator = deps.createOrchestrator();
        await orchestrator.start(msg.txnId, msg.sessionId, msg.voice ?? deps.defaultVoice);
        active = { txnId: msg.txnId, orchestrator, startMs: performance.now() };
        return;
      }
      if (msg.type === "synth-text") {
        if (cancelledTxnIds.has(msg.txnId)) return;
        if (erroredTxnIds.has(msg.txnId)) return;
        if (!active || active.txnId !== msg.txnId) throw new Error("no active synth stream");
        await active.orchestrator.feed(msg.text, () => cancelledTxnIds.has(msg.txnId));
        return;
      }
      if (msg.type === "synth-end") {
        if (cancelledTxnIds.has(msg.txnId)) {
          cancelledTxnIds.delete(msg.txnId);
          return;
        }
        if (erroredTxnIds.has(msg.txnId)) {
          erroredTxnIds.delete(msg.txnId);
          return;
        }
        if (!active || active.txnId !== msg.txnId) throw new Error("no active synth stream");
        const { audioSec } = await active.orchestrator.finish();
        deps.post({
          type: "synth-end-ok",
          txnId: msg.txnId,
          wallMs: performance.now() - active.startMs,
          audioSec,
        });
        active = null;
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[worker] ${msg.type} failed:`, err);
      const errMsg: OutMsg = { type: "error", message };
      if ("id" in msg && typeof msg.id === "number") errMsg.id = msg.id;
      if ("txnId" in msg && typeof msg.txnId === "number") errMsg.txnId = msg.txnId;
      deps.post(errMsg);
      if ("txnId" in msg && typeof msg.txnId === "number") {
        erroredTxnIds.add(msg.txnId);
        active = null;
      }
    }
  }

  async function drain(): Promise<void> {
    await workQueue;
  }

  return { onMessage, drain };
}
