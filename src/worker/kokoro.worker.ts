/// <reference lib="webworker" />

import { env as hfEnv } from "@huggingface/transformers";
import { ProgressiveEncoder } from "../hls/encode";
import { installModelCacheFetch } from "./modelCache";
import { KokoroSynthesisClient } from "./synthesisModel";
import type { VoiceId } from "./types";
import type { DeviceInfo, InMsg, LoadedDevice, OutMsg } from "./workerProtocol";
import { createHandlers } from "./workerProtocol";

// Injected as JSON via `new Worker(url, { name })`.
export interface KokoroWorkerConfig {
  installModelCacheFetch: boolean;
  ortWasm: {
    numThreads: number;
    proxy: boolean;
    // undefined overrides transformers.js's CDN default; forces bundled WASM.
    wasmPaths: string | undefined;
  };
}

const cfg = JSON.parse(self.name) as KokoroWorkerConfig;
if (cfg.installModelCacheFetch) installModelCacheFetch();
const ortWasm = hfEnv.backends.onnx.wasm!;
ortWasm.numThreads = cfg.ortWasm.numThreads;
ortWasm.proxy = cfg.ortWasm.proxy;
ortWasm.wasmPaths = cfg.ortWasm.wasmPaths;

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
