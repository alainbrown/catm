# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**catm** is a 100% in-browser long-form text-to-speech reader. All synthesis runs locally — the Kokoro 82M TTS model is downloaded once into the browser's HTTP cache and run via ONNX Runtime Web (WebGPU with WASM fallback). There is no server. Deploys to GitHub Pages from `main`.

See `RESEARCH.md` for the rationale behind model choices (Kokoro for Low tier; SaT for chunking; planned Medium/High tiers).

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — typecheck (`tsc -b`) + `vite build` to `dist/`
- `npm run lint` — Biome check (lint + format diff). `npm run format` to autoformat.
- `npm test` — Vitest (node env, runs `src/**/*.test.ts{,x}`). `npm run test:watch` for watch mode. Single file: `npx vitest run src/textChunk.test.ts`.
- `npm run e2e` — Playwright (Chromium only, single worker, 5-min test timeout). Reuses an existing dev server on :5173 if running; otherwise spawns one. Single test: `npx playwright test -g "synth saves session"`.

Playwright launches Chrome with `--enable-features=SharedArrayBuffer` — needed so the worker can run ONNX. If you change the e2e harness, preserve that flag.

## Architecture

The app is one React surface (`src/App.tsx`) that owns nearly all state and drives a Web Worker for TTS plus an OPFS-backed HLS session store for audio.

### Three storage layers

1. **`localStorage`** — onboarding flag (`catm:onboarded`), voice preference (`catm:voice`).
2. **IndexedDB (`catm` DB, store `sessions`)** — session metadata (`SessionMeta`: id, title, sourceText, duration, voice, etc.). Schema is at `DB_VERSION = 3`; **upgrades drop the store and wipe OPFS — there is no migration path**. Bumping the version is a data-loss operation by design (the HLS layout replaced an earlier single-mp4 layout).
3. **OPFS (`sessions/<id>/`)** — per-session audio as HLS: `init.mp4`, `seg-N.m4s` fragments, and a live `playlist.m3u8`. The Kokoro model weights themselves live in the browser's HTTP cache (Cache Storage), not OPFS.

`src/storage/sessionStore.ts` is the single entry point for both IDB and OPFS.

### Synthesis pipeline (progressive HLS)

Long text is sliced into ~300-char chunks (`src/textChunk.ts`, sentence-boundary aware). The flow:

1. App posts `synth-start` → `synth-chunk` × N → `synth-end` to `src/worker/kokoro.worker.ts`.
2. The worker drives `KokoroTTS.generate()` per chunk, feeding PCM into `ProgressiveEncoder` (`src/hls/encode.ts`), which upsamples 24 kHz → 48 kHz (linear 2×, valid since the source is band-limited) and AAC-encodes into fragmented MP4 via WebCodecs `AudioEncoder` + `mp4-muxer`'s `StreamTarget`.
3. The encoder emits a single `init.mp4` then one `seg-N.m4s` per chunk back to the main thread, which writes them to OPFS and rewrites `playlist.m3u8` after every segment (PLAYLIST-TYPE `EVENT`, no `ENDLIST` until finalised).
4. `ReaderView` attaches `hls.js` to an `<audio>` element via a custom `OpfsLoader` (`src/hls/playback.ts`) that resolves `opfs://{sessionId}/{filename}` URLs against `readSessionFile`. hls.js's normal EVENT-playlist reload cadence handles the live append.

### Worker concurrency invariant

`kokoro.worker.ts` serialises all incoming messages onto a single promise chain (`workQueue`). This is load-bearing: Chrome dispatches messages while the previous handler awaits, and without the chain a `synth-chunk` resume could race a later `synth-end` tearing down the encoder. Do not parallelise the handler.

### Worker boot, devices, progress

The worker prefers `device: "webgpu"` + `fp32` and falls back to `wasm` + `q8`. Progress events from kokoro-js are forwarded raw; the App aggregates per-file `{loaded, total}` into a single download bar. The worker is **not** started until the user clicks "Download voice" on first launch — onboarding is gated by `catm:onboarded` in localStorage. "Delete model" clears that flag, terminates the worker, and purges any Cache Storage keys containing `kokoro`/`transformers`/`hf`.

### Voice preview vs. full read

`type: "synth"` is a one-shot path used only by the voice-preview chip — it returns raw PCM, which the main thread encodes with `encodePcmToCompleteMp4` (the non-streaming sibling of `ProgressiveEncoder`) for a quick `<audio>` blob. The full read path uses the `synth-start`/`chunk`/`end` streaming protocol described above.

### App-level state shape

`App.tsx` holds `status: AppStatus` (a discriminated union — `first-launch | loading | downloading | ready | synthesising | error`) and `doc: DocState` (current draft/loaded session). `modified` is derived: text differs from `savedText`, OR the saved audio's voice differs from the currently selected voice (changing voice invalidates audio). Navigating away from a modified doc opens `DiscardDialog`.

## Conventions

- **TypeScript is strict** with `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`. Type-only imports must use `import type`.
- **Biome** is the linter/formatter (2-space, double quotes, semicolons, 100-col). `noNonNullAssertion` is off; `noExplicitAny` is a warning.
- Tests live next to source as `*.test.ts(x)`. Vitest runs in `node` env — anything browser-specific (Web Workers, OPFS, WebCodecs, hls.js) is **not** unit-testable here; cover it in Playwright e2e instead.
- E2E philosophy (from user memory): drive real user journeys end-to-end; do not write shell-loaded smoke tests, do not mock the worker or storage.
- `vite.config.ts` excludes `onnxruntime-web` and `kokoro-js` from dep optimisation and sets `worker.format: "es"` — needed for the ESM worker + WebGPU shaders to load correctly. Don't change these without testing the worker boot path.
- `base: "./"` in vite config produces relative asset URLs so the GitHub Pages deploy works under a subpath.
