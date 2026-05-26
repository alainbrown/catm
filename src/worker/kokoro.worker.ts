/// <reference lib="webworker" />

import { env as hfEnv } from "@huggingface/transformers";
import { ProgressiveEncoder } from "../hls/encode";
import { installModelCacheFetch } from "./modelCache";
import { KokoroSynthesisClient } from "./synthesisModel";
import type { VoiceId } from "./types";
import type { DeviceInfo, InMsg, LoadedDevice, OutMsg } from "./workerProtocol";
import { createHandlers } from "./workerProtocol";

if (import.meta.env.MODE === "extension") {
  // No SW to cache-first the HF model weights; do it from the worker.
  installModelCacheFetch();
  // MV3 forbids `blob:` in script-src and forbids remote scripts. Three
  // ORT-Web defaults trip those rules — disable them and point ORT at the
  // bundled wasm (`wasmPaths = undefined` → use co-located files):
  //   - multi-threaded WASM spawns pthread workers via blob:
  //   - the proxy worker also spawns via blob:
  //   - the default `wasmPaths` is a jsDelivr CDN URL
  // Same pattern used by tantara/transformers.js-chrome (Plasmo) in prod.
  const wasm = hfEnv.backends.onnx.wasm!;
  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = undefined;
}

export type { VoiceId } from "./types";
export type { InMsg, OutMsg } from "./workerProtocol";

function post(msg: OutMsg, transfer: Transferable[] = []): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

const SAMPLE_RATE = 24000;
const DEFAULT_VOICE: VoiceId = "af_heart";

const device: LoadedDevice =
  typeof navigator !== "undefined" && "gpu" in navigator ? "webgpu" : "wasm";

const synthClient = new KokoroSynthesisClient({
  device,
  onProgress: (event) => {
    post({
      type: "progress",
      status: event.status,
      file: event.file,
      loaded: event.loaded,
      total: event.total,
    });
  },
});

interface GPUAdapterLike {
  features: { has: (name: string) => boolean } & Iterable<string>;
  info?: { description?: string; vendor?: string; architecture?: string };
  requestAdapterInfo?: () => Promise<{
    description?: string;
    vendor?: string;
    architecture?: string;
  }>;
}
interface AdapterRequester {
  requestAdapter: () => Promise<GPUAdapterLike | null>;
}

async function probeAdapter(): Promise<{
  name: string;
  vendor: string;
  features: string[];
}> {
  const empty = { name: "", vendor: "", features: [] as string[] };
  const gpu = (navigator as unknown as { gpu?: AdapterRequester }).gpu;
  if (!gpu) return empty;
  let adapter: GPUAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch {
    return empty;
  }
  if (!adapter) return empty;
  let info: { description?: string; vendor?: string; architecture?: string } = {};
  if (adapter.info) info = adapter.info;
  else if (adapter.requestAdapterInfo) {
    try {
      info = await adapter.requestAdapterInfo();
    } catch {
      /* ignore */
    }
  }
  // Prefer architecture ("metal-3", "rdna-3", …) over the verbose description.
  const name = info.architecture || info.description || "";
  const features: string[] = [];
  try {
    for (const f of adapter.features) features.push(f);
  } catch {
    /* iteration unsupported */
  }
  return { name, vendor: info.vendor ?? "", features };
}

async function load(): Promise<DeviceInfo> {
  const t0 = performance.now();
  const [, adapter] = await Promise.all([
    synthClient.ensureLoaded(),
    device === "webgpu" ? probeAdapter() : Promise.resolve({ name: "", vendor: "", features: [] }),
  ]);
  return {
    device,
    adapterName: adapter.name,
    adapterVendor: adapter.vendor,
    features: adapter.features,
    sessionInitMs: performance.now() - t0,
  };
}

const handlers = createHandlers<VoiceId>({
  load,
  synthesizePcm: (text, voice) => synthClient.synthesize(text, voice),
  streamSentences: (text, voice, onSentence, isCancelled) =>
    synthClient.stream(text, voice, onSentence, isCancelled),
  createEncoder: (sampleRate, onInit, onSegment) =>
    new ProgressiveEncoder(sampleRate, onInit, onSegment),
  post: (msg, transfer = []) => post(msg, transfer),
  sampleRate: SAMPLE_RATE,
  defaultVoice: DEFAULT_VOICE,
});

self.addEventListener("message", (ev: MessageEvent<InMsg>) => {
  handlers.onMessage(ev.data);
});
