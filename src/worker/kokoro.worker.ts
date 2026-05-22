/// <reference lib="webworker" />
/// <reference path="../../node_modules/onnxruntime-web/types.d.ts" />
import * as ort from "onnxruntime-web/webgpu";
import { ProgressiveEncoder } from "../hls/encode";
import type { Tokenizer } from "./textPipeline";
import {
  STYLE_DIM,
  parseTokenizer,
  phonemizeKokoro,
  sliceStyle,
  styleBucket,
  tokenize,
  voiceFileBuckets,
} from "./textPipeline";
import type { VoiceId } from "./types";
import type { DeviceInfo, InMsg, LoadedDevice, OutMsg } from "./workerProtocol";
import { createHandlers } from "./workerProtocol";

export type { VoiceId } from "./types";
export type { InMsg, OutMsg } from "./workerProtocol";

function post(msg: OutMsg, transfer: Transferable[] = []): void {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);
}

const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_BASE = `https://huggingface.co/${MODEL_REPO}/resolve/main`;
const SAMPLE_RATE = 24000;
const MODEL_CACHE = "kokoro-model";
const VOICE_CACHE = "kokoro-voices";
const TOKENIZER_CACHE = "kokoro-tokenizer";

const DEFAULT_VOICE: VoiceId = "af_heart";

interface Loaded {
  session: ort.InferenceSession;
  device: LoadedDevice;
  info: DeviceInfo;
}

let loaded: Promise<Loaded> | null = null;

let tokenizerPromise: Promise<Tokenizer> | null = null;

async function loadTokenizer(): Promise<Tokenizer> {
  if (tokenizerPromise) return tokenizerPromise;
  tokenizerPromise = (async () => {
    const [tokBuf, cfgBuf] = await Promise.all([
      cachedFetch(`${MODEL_BASE}/tokenizer.json`, TOKENIZER_CACHE),
      cachedFetch(`${MODEL_BASE}/tokenizer_config.json`, TOKENIZER_CACHE),
    ]);
    const dec = new TextDecoder();
    return parseTokenizer(JSON.parse(dec.decode(tokBuf)), JSON.parse(dec.decode(cfgBuf)));
  })();
  return tokenizerPromise;
}

// ─── networking + caching ───────────────────────────────────────────────────
async function cachedFetch(
  url: string,
  cacheName: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ArrayBuffer> {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(url);
  if (hit) {
    const buf = await hit.arrayBuffer();
    onProgress?.(buf.byteLength, buf.byteLength);
    return buf;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || !onProgress) {
    const buf = await res.arrayBuffer();
    onProgress?.(buf.byteLength, buf.byteLength || buf.byteLength);
    try {
      await cache.put(url, new Response(buf, { headers: res.headers }));
    } catch (err) {
      console.warn("[kokoro] cache put failed (continuing without cache):", err);
    }
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loadedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loadedBytes += value.byteLength;
    onProgress(loadedBytes, total || loadedBytes);
  }
  const merged = new Uint8Array(loadedBytes);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  try {
    await cache.put(url, new Response(merged, { headers: res.headers }));
  } catch (err) {
    console.warn("[kokoro] cache put failed (continuing without cache):", err);
  }
  return merged.buffer;
}

// ─── load + session ─────────────────────────────────────────────────────────
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
  requestAdapter: (opts?: { powerPreference?: string }) => Promise<GPUAdapterLike | null>;
}

async function probeAdapter(): Promise<{ adapter: GPUAdapterLike | null; hasF16: boolean }> {
  const gpu = (navigator as unknown as { gpu?: AdapterRequester }).gpu;
  if (!gpu) return { adapter: null, hasF16: false };
  try {
    const adapter = await gpu.requestAdapter();
    return { adapter, hasF16: !!adapter?.features?.has("shader-f16") };
  } catch {
    return { adapter: null, hasF16: false };
  }
}

async function adapterDescription(adapter: GPUAdapterLike | null): Promise<{
  name: string;
  vendor: string;
  features: string[];
}> {
  if (!adapter) return { name: "", vendor: "", features: [] };
  // adapter.info is the modern accessor; requestAdapterInfo() the legacy one.
  let info: { description?: string; vendor?: string; architecture?: string } = {};
  if (adapter.info) info = adapter.info;
  else if (adapter.requestAdapterInfo) {
    try {
      info = await adapter.requestAdapterInfo();
    } catch {
      /* ignore */
    }
  }
  // Combine architecture + description into a single human-readable name.
  const name = info.description || info.architecture || "";
  const features: string[] = [];
  try {
    for (const f of adapter.features) features.push(f);
  } catch {
    /* iteration unsupported */
  }
  return { name, vendor: info.vendor ?? "", features };
}

const WEBGPU_SESSION_OPTIONS: ort.InferenceSession.SessionOptions = {
  executionProviders: ["webgpu"],
};

function load(): Promise<Loaded> {
  if (loaded) return loaded;
  loaded = (async () => {
    const onProgress = (file: string, loadedBytes: number, total: number): void => {
      post({
        type: "progress",
        status: loadedBytes >= total ? "done" : "progress",
        file,
        loaded: loadedBytes,
        total,
      });
    };

    const { adapter, hasF16 } = await probeAdapter();
    const desc = await adapterDescription(adapter);

    if (hasF16) {
      try {
        const file = "model.onnx";
        const bytes = await cachedFetch(`${MODEL_BASE}/onnx/${file}`, MODEL_CACHE, (l, t) =>
          onProgress(file, l, t),
        );
        const t0 = performance.now();
        const session = await ort.InferenceSession.create(bytes, WEBGPU_SESSION_OPTIONS);
        const sessionInitMs = performance.now() - t0;
        const info: DeviceInfo = {
          device: "webgpu",
          adapterName: desc.name,
          adapterVendor: desc.vendor,
          features: desc.features,
          sessionInitMs,
        };
        return { session, device: "webgpu", info };
      } catch (err) {
        console.warn("[kokoro] WebGPU load failed, falling back to WASM", err);
      }
    }
    const wasmFile = "model.onnx";
    const wasmBytes = await cachedFetch(`${MODEL_BASE}/onnx/${wasmFile}`, MODEL_CACHE, (l, t) =>
      onProgress(wasmFile, l, t),
    );
    const t0 = performance.now();
    const session = await ort.InferenceSession.create(wasmBytes, {
      executionProviders: ["wasm"],
    });
    const sessionInitMs = performance.now() - t0;
    const info: DeviceInfo = {
      device: "wasm",
      adapterName: "",
      adapterVendor: "",
      features: [],
      sessionInitMs,
    };
    return { session, device: "wasm", info };
  })();
  return loaded;
}

// ─── voice loading ──────────────────────────────────────────────────────────
const voiceCache = new Map<VoiceId, Float32Array>();
async function loadVoice(voice: VoiceId): Promise<Float32Array> {
  const hit = voiceCache.get(voice);
  if (hit) return hit;
  const buf = await cachedFetch(
    `${MODEL_BASE}/voices/${voice}.bin`,
    VOICE_CACHE,
    (loadedBytes, total) =>
      post({
        type: "progress",
        status: "progress",
        file: `${voice}.bin`,
        loaded: loadedBytes,
        total,
      }),
  );
  const vec = new Float32Array(buf);
  voiceCache.set(voice, vec);
  return vec;
}

// ─── inference ──────────────────────────────────────────────────────────────
async function synthesizePcm(text: string, voice: VoiceId): Promise<Float32Array> {
  const [{ session }, tokenizer] = await Promise.all([load(), loadTokenizer()]);
  const phonemes = await phonemizeKokoro(text, "a");
  const ids = tokenize(phonemes, tokenizer);
  const voiceVec = await loadVoice(voice);
  const buckets = voiceFileBuckets(voiceVec.byteLength);
  const bucket = styleBucket(ids.length, buckets);
  const style = sliceStyle(voiceVec, bucket);

  const feeds: Record<string, ort.Tensor> = {
    input_ids: new ort.Tensor("int64", ids, [1, ids.length]),
    style: new ort.Tensor("float32", style, [1, STYLE_DIM]),
    speed: new ort.Tensor("float32", new Float32Array([1]), [1]),
  };
  const out = await session.run(feeds);
  const waveform = out.waveform ?? out.audio ?? Object.values(out)[0];
  if (!waveform) throw new Error("no waveform output from model");
  return waveform.data as Float32Array;
}

// ─── worker protocol wiring ─────────────────────────────────────────────────
const handlers = createHandlers({
  load: async () => (await load()).info,
  synthesizePcm,
  createEncoder: (sampleRate, onInit, onSegment) =>
    new ProgressiveEncoder(sampleRate, onInit, onSegment),
  post: (msg, transfer = []) => post(msg, transfer),
  sampleRate: SAMPLE_RATE,
  defaultVoice: DEFAULT_VOICE,
});

self.addEventListener("message", (ev: MessageEvent<InMsg>) => {
  handlers.onMessage(ev.data);
});
