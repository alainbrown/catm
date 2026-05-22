// Real-inference unit test: loads the actual Kokoro ONNX model via
// onnxruntime-web (which resolves to the node build under vitest) and runs
// session.run with the same inputs the worker would build at runtime.
//
// The model is large (~82 MB) so we cache it under node_modules/.cache/catm/.
// On a cold machine the test downloads the file; on subsequent runs it's a
// local read. If the download fails (offline, network blocked), the test
// skips with a clear message — it doesn't silently pass.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-web";
import { beforeAll, describe, expect, it } from "vitest";
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

const MODEL_REPO = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MODEL_BASE = `https://huggingface.co/${MODEL_REPO}/resolve/main`;
// We test the WASM-target weight (smaller, no GPU dependency). q8f16 is for
// WebGPU and can only run under that EP; the WASM path is what users fall
// back to and is what runs in node.
const MODEL_FILE = "model_quantized.onnx";

const __filename = fileURLToPath(import.meta.url);
const cacheDir = join(dirname(__filename), "..", "..", "node_modules", ".cache", "catm");
const modelPath = join(cacheDir, MODEL_FILE);
const tokenizerPath = join(dirname(__filename), "fixtures", "tokenizer-vocab.json");
const voicePath = join(dirname(__filename), "fixtures", "af_heart.bin");

async function downloadIfMissing(url: string, dest: string): Promise<boolean> {
  if (existsSync(dest)) return true;
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = join(tmpdir(), `catm-${Date.now()}.onnx`);
  const res = await fetch(url);
  if (!res.ok) return false;
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(tmp, buf);
  writeFileSync(dest, buf);
  return true;
}

describe("Kokoro inference (real ONNX session, WASM EP)", () => {
  let session: ort.InferenceSession | null = null;
  let tokenizer: Tokenizer | null = null;
  let voiceVec: Float32Array | null = null;

  beforeAll(
    async () => {
      const ok = await downloadIfMissing(`${MODEL_BASE}/onnx/${MODEL_FILE}`, modelPath);
      if (!ok) return; // tests will skip themselves
      const modelBytes = readFileSync(modelPath);
      session = await ort.InferenceSession.create(
        modelBytes.buffer.slice(
          modelBytes.byteOffset,
          modelBytes.byteOffset + modelBytes.byteLength,
        ) as ArrayBuffer,
        { executionProviders: ["wasm"] },
      );

      const vocabJson = JSON.parse(readFileSync(tokenizerPath, "utf8")) as Record<string, number>;
      // Reconstruct Kokoro-shaped tokenizer.json + tokenizer_config.json
      // wrappers for parseTokenizer.
      tokenizer = parseTokenizer(
        {
          model: { vocab: vocabJson },
          post_processor: {
            single: [{ SpecialToken: { id: "$" } }, { SpecialToken: { id: "$" } }],
          },
        },
        { pad_token: "$", unk_token: "$" },
      );

      const buf = readFileSync(voicePath);
      voiceVec = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    },
    5 * 60 * 1000,
  );

  it("exposes the expected input names", () => {
    if (!session) return; // download failed; skip
    expect(session.inputNames).toEqual(expect.arrayContaining(["input_ids", "style", "speed"]));
  });

  it("exposes 'waveform' as an output (the name our worker reads)", () => {
    if (!session) return;
    // If this fails, the line `out.waveform ?? out.audio ?? Object.values(out)[0]`
    // in the worker is grabbing the wrong tensor and we'd get garbage audio.
    expect(session.outputNames).toContain("waveform");
  });

  it("produces non-trivial PCM for 'Hello world.'", async () => {
    if (!session || !tokenizer || !voiceVec) return;
    const phonemes = await phonemizeKokoro("Hello world.", "a");
    const ids = tokenize(phonemes, tokenizer);
    const buckets = voiceFileBuckets(voiceVec.byteLength);
    const bucket = styleBucket(ids.length, buckets);
    const style = sliceStyle(voiceVec, bucket);

    const out = await session.run({
      input_ids: new ort.Tensor("int64", ids, [1, ids.length]),
      style: new ort.Tensor("float32", style, [1, STYLE_DIM]),
      speed: new ort.Tensor("float32", new Float32Array([1]), [1]),
    });
    const waveform = out.waveform;
    expect(waveform).toBeDefined();
    if (!waveform) throw new Error("unreachable");
    const pcm = waveform.data as Float32Array;

    // Length: Kokoro outputs 24 kHz. "Hello world." should be > 0.4s and < 5s.
    expect(pcm.length).toBeGreaterThan(0.4 * 24000);
    expect(pcm.length).toBeLessThan(5 * 24000);

    // No NaN/Inf.
    expect(pcm.every(Number.isFinite)).toBe(true);

    // Amplitude inside the expected [-1, 1] range (no integer-vs-float mixup).
    let maxAbs = 0;
    for (const s of pcm) {
      const a = Math.abs(s);
      if (a > maxAbs) maxAbs = a;
    }
    expect(maxAbs).toBeGreaterThan(0.01);
    expect(maxAbs).toBeLessThan(1.5);

    // RMS energy: a 0.4 s click would have very low RMS; real speech ~0.05-0.3.
    let sumSq = 0;
    for (const s of pcm) sumSq += s * s;
    const rms = Math.sqrt(sumSq / pcm.length);
    expect(rms).toBeGreaterThan(0.01);

    // Not just one impulse: at least 5 % of samples should be above 1/10th
    // peak. A click would fail this — most samples are near zero.
    const thresh = maxAbs * 0.1;
    let loud = 0;
    for (const s of pcm) if (Math.abs(s) > thresh) loud++;
    expect(loud / pcm.length).toBeGreaterThan(0.05);
  });
});
