# catm — come and talk to me

[![Test](https://github.com/catm-app/catm-app.github.io/actions/workflows/test.yml/badge.svg)](https://github.com/catm-app/catm-app.github.io/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/imkogmgncjobcjeofjeekegihcikgbbm?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/imkogmgncjobcjeofjeekegihcikgbbm)

**Get it →** [catm-app.github.io](https://catm-app.github.io/)

<p align="center">
  <img src="./docs/demo.gif" alt="catm — select text, right-click Read aloud, listen — everything runs in the browser" width="720" />
</p>

A 100% in-browser long-form text-to-speech reader, shipped as a Chrome extension. Select any text on any page, right-click **Read aloud**, and the side panel reads it back to you. Synthesis runs locally on your machine — no server, no upload, no account.

The Kokoro 82M TTS model is downloaded once into the extension's HTTP cache (~310 MB) and run via ONNX Runtime Web (WebGPU when available, WASM fallback). After the first read, catm works fully offline.

## Highlights

- **Local TTS.** Kokoro 82M via ONNX Runtime Web. Text never leaves the browser.
- **Progressive playback.** Streamed HLS — start listening within a few seconds of clicking Read; the rest synthesises and appends as you go.
- **Persistent library.** Sessions are saved as fragmented MP4 in OPFS. Open old reads instantly, no re-synth.
- **Right-click to listen.** A context-menu entry on any page drops the selection into the side panel and starts reading.
- **Offline-first.** Once the model is cached, the entire extension — including all reads — works with no network.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck + production build of the extension into `extension/app/` |
| `npm run lint` | Biome check (lint + format diff) |
| `npm run format` | Biome autoformat |
| `npm run check:marketing` | Verify every relative href/src in `marketing/*.html` resolves |
| `npm test` | Full suite — Vitest (unit) + Playwright (e2e) |

The marketing site at `catm-app.github.io` has no build step — `deploy.yml` uploads `marketing/` directly to GitHub Pages.

## Browser requirements

- Chrome (or Chromium / Edge / Brave) — the extension uses Chrome's side panel API.
- The page must be **cross-origin isolated** (COOP/COEP) so the worker can use SharedArrayBuffer and threaded WASM. The extension manifest sets the headers directly.
- WebGPU is used when available; otherwise the worker falls back to multi-threaded WASM.

## Architecture in one paragraph

`src/App.tsx` owns the state and drives a Web Worker (`src/worker/kokoro.worker.ts`) that runs Kokoro. Text is streamed sentence-by-sentence through kokoro-js (with a phoneme-token-aware splitter that respects Kokoro's 510-token input cap), each sentence is synthesised to PCM, fed through a WebCodecs AAC encoder into fragmented MP4, and written to OPFS as live HLS (`init.mp4` + `seg-N.m4s` + a continually-updated `playlist.m3u8`). `hls.js` plays it back via a custom `opfs://` loader. Session metadata lives in IndexedDB; the audio bytes live in OPFS. A small `fetch` wrapper in the worker provides a cache-first route for the Kokoro model weights from huggingface.co into the `catm-model-v1` Cache Storage bucket.

See [`CLAUDE.md`](./CLAUDE.md) for the deeper map (storage layers, worker concurrency invariant, extension ingest).

## Browser extension

`extension/` is a Chrome MV3 extension that hosts the full catm app inside Chrome's **side panel**, plus a right-click **"Read aloud"** entry that drops the current selection into the panel and opens it. The same bundle runs in a popped-out tab via the arrow icon in the panel's brand bar — both views share OPFS / IndexedDB / the cached model since they're the same `chrome-extension://` origin.

The extension is self-contained: it bundles the React app under `extension/app/` and uses no remote scripts. WebGPU works inside the panel — the worker disables ORT-Web's blob-based loaders (`numThreads = 1`, `proxy = false`, `wasmPaths = undefined`) so nothing trips MV3's CSP.

To build and load it:

```bash
npm run build
```

Then `chrome://extensions` → Developer mode → **Load unpacked** → pick the `extension/` directory.

## Privacy

Everything runs in your browser — no server, no upload, no account. Full policy at [catm-app.github.io/privacy.html](https://catm-app.github.io/privacy.html).

## License

MIT.
