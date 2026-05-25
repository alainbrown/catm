# catm — come and talk to me

[![Test](https://github.com/catm-app/catm-app.github.io/actions/workflows/test.yml/badge.svg)](https://github.com/catm-app/catm-app.github.io/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

**Try it →** [catm-app.github.io](https://catm-app.github.io/)

<p align="center">
  <img src="./docs/demo.gif" alt="catm — paste text, pick a voice, listen — everything runs in the browser" width="720" />
</p>

A 100% in-browser long-form text-to-speech reader. Paste a long document, pick a voice, get a navigable audiobook. Synthesis runs locally on your machine — no server, no upload, no account.

The Kokoro 82M TTS model is downloaded once into your browser's HTTP cache (~310 MB) and run via ONNX Runtime Web (WebGPU when available, WASM fallback). After the first visit, catm works fully offline as an installable PWA.

## Highlights

- **Local TTS.** Kokoro 82M via ONNX Runtime Web. Text never leaves the browser.
- **Progressive playback.** Streamed HLS — start listening within a few seconds of clicking Read; the rest synthesises and appends as you go.
- **Persistent library.** Sessions are saved as fragmented MP4 in OPFS. Open old reads instantly, no re-synth.
- **Installable PWA.** Add to home screen / install on desktop. Share text from other apps, open `.txt` / `.md` files directly.
- **Offline-first.** Once the model is cached, the entire app — including all reads — works with no network.

## Run locally

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run lint` | Biome check (lint + format diff) |
| `npm run format` | Biome autoformat |
| `npm test` | Vitest (unit tests) |
| `npm run e2e` | Playwright (Chromium, real worker, real storage) |
| `npm run icons` | Regenerate PWA icon set from `public/favicon.svg` |

## Browser requirements

- A Chromium-based browser is the smoothest path. Firefox and Safari are best-effort.
- The page must be **cross-origin isolated** (COOP/COEP) so the worker can use SharedArrayBuffer and threaded WASM. The service worker injects the headers itself, which means GitHub Pages and any other plain static host work without server config.
- WebGPU is used when available; otherwise the worker falls back to multi-threaded WASM.
- iOS Safari (16.4+) installs as a standalone PWA. Performance is bound by WASM since iOS doesn't expose WebGPU broadly yet.

## Architecture in one paragraph

`src/App.tsx` owns the state and drives a Web Worker (`src/worker/kokoro.worker.ts`) that runs Kokoro. Text is streamed sentence-by-sentence through kokoro-js (with a phoneme-token-aware splitter that respects Kokoro's 510-token input cap), each sentence is synthesised to PCM, fed through a WebCodecs AAC encoder into fragmented MP4, and written to OPFS as live HLS (`init.mp4` + `seg-N.m4s` + a continually-updated `playlist.m3u8`). `hls.js` plays it back via a custom `opfs://` loader. Session metadata lives in IndexedDB; the audio bytes live in OPFS. The unified service worker (`src/sw.ts`) handles COI headers, app-shell precache, the Kokoro model cache, and an offline navigation fallback.

See [`CLAUDE.md`](./CLAUDE.md) for the deeper map (storage layers, worker concurrency invariant, update flow, PWA ingest).

## Browser extension

`extension/` is a small Chrome MV3 extension that adds a right-click **"Send selection to catm"** entry. Highlight text on any page, right-click, and the selection is opened in catm via the PWA's `share_target` (reusing an existing catm tab if one is open). Clicking the toolbar icon opens catm directly. The extension only requests permission for `catm-app.github.io` — it never reads page contents.

To load it: open `chrome://extensions`, turn on Developer mode, **Load unpacked**, and pick the `extension/` directory.

## Privacy

Everything runs in your browser — no server, no upload, no account. Full policy at [catm-app.github.io/privacy.html](https://catm-app.github.io/privacy.html).

## License

MIT.
