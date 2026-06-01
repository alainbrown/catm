import { AudioBuffer } from "./audioBuffer";
import type { KokoroModel } from "./model";
import { TextBuffer } from "./textBuffer";
import type { VoiceId } from "./types";
import type { OutMsg } from "./workerProtocol";

// Mount the player once this many segments are written, so hls.js's first
// playlist read prefetches a useful window.
const PLAYBACK_BUFFER_SEGMENTS = 3;

export interface OrchestratorDeps {
  model: KokoroModel;
  splitSentences: (text: string) => string[];
  sampleRate: number;
  post: (msg: OutMsg) => void;
}

// Owns the two buffers for one synthesis: pull pieces from a TextBuffer,
// generate PCM, push to an AudioBuffer that writes HLS to OPFS.
export class Orchestrator {
  private audio: AudioBuffer | null = null;
  private txnId = -1;
  private sessionId = "";
  private voice!: VoiceId;
  private playbackSignaled = false;

  constructor(private readonly deps: OrchestratorDeps) {}

  async start(txnId: number, sessionId: string, voice: VoiceId): Promise<void> {
    this.txnId = txnId;
    this.sessionId = sessionId;
    this.voice = voice;
    this.playbackSignaled = false;
    this.audio = new AudioBuffer(sessionId, this.deps.sampleRate, (count) => {
      if (count >= PLAYBACK_BUFFER_SEGMENTS) this.signalPlayback();
    });
    await this.audio.start();
  }

  async feed(text: string, isCancelled: () => boolean): Promise<void> {
    if (!this.audio) throw new Error("orchestrator not started");
    const audio = this.audio;
    const measure = this.deps.model.makeMeasure(this.voice);
    const buffer = new TextBuffer(text, { splitSentences: this.deps.splitSentences, measure });
    while (buffer.hasNext()) {
      if (isCancelled()) return;
      const piece = await buffer.next();
      if (piece === null) break;
      if (isCancelled()) return;
      const pcm = await this.deps.model.generate(piece, this.voice);
      await audio.push(pcm);
      this.deps.post({
        type: "chunk-encoded",
        txnId: this.txnId,
        text: piece,
        durationSec: pcm.length / this.deps.sampleRate,
        samples: pcm.length,
      });
    }
  }

  async finish(): Promise<{ audioSec: number }> {
    if (!this.audio) throw new Error("orchestrator not started");
    await this.audio.finish();
    if (this.audio.segmentCount() > 0) this.signalPlayback();
    return { audioSec: this.audio.audioSec() };
  }

  private signalPlayback(): void {
    if (this.playbackSignaled) return;
    this.playbackSignaled = true;
    this.deps.post({ type: "playback-ready", txnId: this.txnId, sessionId: this.sessionId });
  }
}
