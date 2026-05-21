import { describe, expect, it } from "vitest";
import { pcmToWavBuffer } from "./wav";

describe("pcmToWavBuffer", () => {
  it("emits a RIFF/WAVE header sized to the PCM payload", () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = pcmToWavBuffer(pcm, 24000);
    const view = new DataView(buf);
    expect(
      String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)),
    ).toBe("RIFF");
    expect(
      String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11)),
    ).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint32(40, true)).toBe(pcm.length * 2);
    expect(buf.byteLength).toBe(44 + pcm.length * 2);
  });

  it("clamps out-of-range samples", () => {
    const pcm = new Float32Array([2, -2]);
    const view = new DataView(pcmToWavBuffer(pcm, 24000));
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});
