import Hls, { type LoaderCallbacks, type LoaderConfiguration, type LoaderContext } from "hls.js";
import { readSessionFile } from "../storage/sessionStore";

export interface HlsHandle {
  destroy(): void;
}

/**
 * Attach hls.js to an audio element, reading playlist + init + media segments
 * directly from OPFS for the given session. The playlist file is rewritten
 * incrementally during progressive synthesis; hls.js reloads it on its own
 * EVENT-playlist cadence until #EXT-X-ENDLIST is present.
 */
export function attachHlsToAudio(audio: HTMLAudioElement, sessionId: string): HlsHandle {
  class OpfsLoader {
    private aborted = false;
    private stats = {
      aborted: false,
      loaded: 0,
      retry: 0,
      total: 0,
      chunkCount: 0,
      bwEstimate: 0,
      loading: { start: 0, first: 0, end: 0 },
      parsing: { start: 0, end: 0 },
      buffering: { start: 0, first: 0, end: 0 },
    };
    context!: LoaderContext;

    load<C extends LoaderContext>(
      context: C,
      _config: LoaderConfiguration,
      callbacks: LoaderCallbacks<C>,
    ): void {
      this.context = context;
      const startedAt = performance.now();
      this.stats.loading.start = startedAt;
      const name = filenameFromUrl(context.url);
      void readSessionFile(sessionId, name).then((bytes) => {
        if (this.aborted) return;
        if (!bytes) {
          callbacks.onError({ code: 404, text: `not found: ${name}` }, context, null, this.stats);
          return;
        }
        const now = performance.now();
        this.stats.loaded = bytes.byteLength;
        this.stats.total = bytes.byteLength;
        this.stats.loading.first = now;
        this.stats.loading.end = now;
        const data =
          context.responseType === "arraybuffer"
            ? (bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
              ) as ArrayBuffer)
            : new TextDecoder().decode(bytes);
        callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
      });
    }
    abort(): void {
      this.aborted = true;
      this.stats.aborted = true;
    }
    destroy(): void {
      this.aborted = true;
    }
    getCacheAge?(): number | null {
      return null;
    }
    getResponseHeader?(_name: string): string | null {
      return null;
    }
  }

  const hls = new Hls({
    loader: OpfsLoader as unknown as typeof Hls.DefaultConfig.loader,
    // hls.js types want explicit configs for these too but the cast above is
    // enough at runtime; the default loader covers the rest.
  } as unknown as Partial<typeof Hls.DefaultConfig>);

  hls.loadSource(`opfs://${sessionId}/playlist.m3u8`);
  hls.attachMedia(audio);

  let destroyed = false;
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      hls.destroy();
    },
  };
}

function filenameFromUrl(url: string): string {
  // URLs are of the form opfs://{sessionId}/{filename}
  const slash = url.lastIndexOf("/");
  return slash >= 0 ? url.slice(slash + 1) : url;
}
