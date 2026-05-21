// Worker-safe encoding utilities. No DOM-only APIs (e.g. OfflineAudioContext)
// because this file is imported from kokoro.worker.ts.
import { ArrayBufferTarget, Muxer, StreamTarget } from "mp4-muxer";

export const ENCODE_SAMPLE_RATE = 48_000;
export const AAC_FRAME_SIZE = 1024;
export const AAC_BITRATE = 64_000;

/**
 * 2× linear upsampler. Kokoro emits 24000 Hz; Chrome's WebCodecs AAC encoder
 * only accepts 44100 or 48000 Hz. For 24000 → 48000 the ratio is exactly 2,
 * and linear interpolation introduces no aliasing (the source is band-limited
 * below 12 kHz, well under the new Nyquist).
 */
export function linearUpsample2x(input: Float32Array): Float32Array {
  const n = input.length;
  if (n === 0) return new Float32Array(0);
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n - 1; i++) {
    const a = input[i] as number;
    const b = input[i + 1] as number;
    out[i * 2] = a;
    out[i * 2 + 1] = (a + b) * 0.5;
  }
  const last = input[n - 1] as number;
  out[(n - 1) * 2] = last;
  out[(n - 1) * 2 + 1] = last;
  return out;
}

/** One-shot encode used by the voice-preview path on the main thread. */
export async function encodePcmToCompleteMp4(
  pcmIn: Float32Array,
  inputSampleRate: number,
): Promise<{ bytes: Uint8Array; durationSec: number }> {
  const pcm =
    inputSampleRate === ENCODE_SAMPLE_RATE
      ? pcmIn
      : inputSampleRate * 2 === ENCODE_SAMPLE_RATE
        ? linearUpsample2x(pcmIn)
        : (() => {
            throw new Error(`unsupported input rate ${inputSampleRate}`);
          })();

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    fastStart: "fragmented",
    audio: { codec: "aac", numberOfChannels: 1, sampleRate: ENCODE_SAMPLE_RATE },
  });
  let encoderError: Error | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => {
      encoderError = e;
    },
  });
  encoder.configure({
    codec: "mp4a.40.2",
    sampleRate: ENCODE_SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: AAC_BITRATE,
  });

  const microsPerSample = 1_000_000 / ENCODE_SAMPLE_RATE;
  for (let offset = 0; offset < pcm.length; offset += AAC_FRAME_SIZE) {
    const frames = Math.min(AAC_FRAME_SIZE, pcm.length - offset);
    const slice = new Float32Array(pcm.buffer, pcm.byteOffset + offset * 4, frames);
    const data = new AudioData({
      format: "f32-planar",
      sampleRate: ENCODE_SAMPLE_RATE,
      numberOfFrames: frames,
      numberOfChannels: 1,
      timestamp: Math.round(offset * microsPerSample),
      data: slice as Float32Array<ArrayBuffer>,
    });
    encoder.encode(data);
    data.close();
  }
  await encoder.flush();
  encoder.close();
  if (encoderError) throw encoderError;
  muxer.finalize();
  return {
    bytes: new Uint8Array(muxer.target.buffer),
    durationSec: pcm.length / ENCODE_SAMPLE_RATE,
  };
}

/**
 * Stateful fragmenter: feed PCM chunks at the source sample rate, get init +
 * media fragments out via callbacks. One instance per synthesis session.
 */
export class ProgressiveEncoder {
  private muxer: Muxer<StreamTarget> | null = null;
  private encoder: AudioEncoder | null = null;
  private inputSampleRate: number;

  private buffer = new Uint8Array(0);
  private parsedOffset = 0;
  private initEmitted = false;
  private pendingMoofStart: number | null = null;
  private fragmentIndex = 0;
  private samplesEncoded = 0;
  private encoderError: Error | null = null;
  private closed = false;

  constructor(
    inputSampleRate: number,
    private readonly onInit: (bytes: Uint8Array) => void,
    private readonly onFragment: (index: number, bytes: Uint8Array, durationSec: number) => void,
  ) {
    this.inputSampleRate = inputSampleRate;
    if (inputSampleRate !== ENCODE_SAMPLE_RATE && inputSampleRate * 2 !== ENCODE_SAMPLE_RATE) {
      throw new Error(`unsupported input rate ${inputSampleRate}`);
    }
  }

  start(): void {
    this.muxer = new Muxer<StreamTarget>({
      target: new StreamTarget({
        onData: (data, position) => this.onBytes(data, position),
        chunked: false,
      }),
      fastStart: "fragmented",
      audio: { codec: "aac", numberOfChannels: 1, sampleRate: ENCODE_SAMPLE_RATE },
      minFragmentDuration: 2.0,
    });

    this.encoder = new AudioEncoder({
      output: (chunk, meta) => this.muxer?.addAudioChunk(chunk, meta),
      error: (e) => {
        this.encoderError = e;
      },
    });
    this.encoder.configure({
      codec: "mp4a.40.2",
      sampleRate: ENCODE_SAMPLE_RATE,
      numberOfChannels: 1,
      bitrate: AAC_BITRATE,
    });
  }

  async pushChunk(pcm: Float32Array): Promise<void> {
    if (!this.encoder) throw new Error("encoder not started");
    const upsampled = this.inputSampleRate === ENCODE_SAMPLE_RATE ? pcm : linearUpsample2x(pcm);
    const microsPerSample = 1_000_000 / ENCODE_SAMPLE_RATE;
    for (let offset = 0; offset < upsampled.length; offset += AAC_FRAME_SIZE) {
      const frames = Math.min(AAC_FRAME_SIZE, upsampled.length - offset);
      const slice = new Float32Array(upsampled.buffer, upsampled.byteOffset + offset * 4, frames);
      const data = new AudioData({
        format: "f32-planar",
        sampleRate: ENCODE_SAMPLE_RATE,
        numberOfFrames: frames,
        numberOfChannels: 1,
        timestamp: Math.round((this.samplesEncoded + offset) * microsPerSample),
        data: slice as Float32Array<ArrayBuffer>,
      });
      this.encoder.encode(data);
      data.close();
    }
    this.samplesEncoded += upsampled.length;
    await this.encoder.flush();
    if (this.encoderError) throw this.encoderError;
    this.drainBoxes();
  }

  async finish(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.encoder) {
      await this.encoder.flush();
      this.encoder.close();
    }
    this.muxer?.finalize();
    this.drainBoxes();
    if (this.encoderError) throw this.encoderError;
  }

  private onBytes(data: Uint8Array, position: number): void {
    if (position !== this.buffer.length) {
      throw new Error(`out-of-order mp4 write: got ${position}, have ${this.buffer.length}`);
    }
    const next = new Uint8Array(this.buffer.length + data.length);
    next.set(this.buffer, 0);
    next.set(data, this.buffer.length);
    this.buffer = next;
  }

  private drainBoxes(): void {
    while (this.parsedOffset + 8 <= this.buffer.length) {
      const boxStart = this.parsedOffset;
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const size = view.getUint32(boxStart);
      const type = readBoxType(this.buffer, boxStart + 4);
      let step: number;
      if (size === 1) {
        if (boxStart + 16 > this.buffer.length) return;
        const hi = view.getUint32(boxStart + 8);
        const lo = view.getUint32(boxStart + 12);
        step = hi * 2 ** 32 + lo;
      } else if (size === 0) {
        return;
      } else {
        step = size;
      }
      if (boxStart + step > this.buffer.length) return;
      const boxEnd = boxStart + step;

      if (!this.initEmitted) {
        // Init segment is everything up to (but not including) the first moof.
        if (type === "moof") {
          const initBytes = this.buffer.slice(0, boxStart);
          this.initEmitted = true;
          this.onInit(initBytes);
          this.pendingMoofStart = boxStart;
        } else {
          // ftyp, moov, free, etc. — keep accumulating into init.
        }
      } else if (type === "moof") {
        this.pendingMoofStart = boxStart;
      } else if (type === "mdat" && this.pendingMoofStart !== null) {
        const fragStart = this.pendingMoofStart;
        const fragBytes = this.buffer.slice(fragStart, boxEnd);
        const sampleCount = readMoofSampleCount(this.buffer, fragStart, boxEnd);
        const durationSec = (sampleCount * AAC_FRAME_SIZE) / ENCODE_SAMPLE_RATE;
        const index = this.fragmentIndex++;
        this.pendingMoofStart = null;
        this.onFragment(index, fragBytes, durationSec);
      }
      this.parsedOffset = boxEnd;
    }
  }
}

function readBoxType(buf: Uint8Array, offset: number): string {
  return String.fromCharCode(
    buf[offset] as number,
    buf[offset + 1] as number,
    buf[offset + 2] as number,
    buf[offset + 3] as number,
  );
}

function readMoofSampleCount(buf: Uint8Array, moofStart: number, moofEnd: number): number {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = moofStart + 8; // skip moof header
  while (p + 8 <= moofEnd) {
    const sz = view.getUint32(p);
    const ty = readBoxType(buf, p + 4);
    if (ty === "traf") {
      let q = p + 8;
      const trafEnd = p + sz;
      while (q + 8 <= trafEnd) {
        const sz2 = view.getUint32(q);
        const ty2 = readBoxType(buf, q + 4);
        if (ty2 === "trun") {
          // full box: 1 byte version + 3 bytes flags, then sample_count (4)
          return view.getUint32(q + 12);
        }
        if (sz2 < 8) return 0;
        q += sz2;
      }
    }
    if (sz < 8) return 0;
    p += sz;
  }
  return 0;
}
