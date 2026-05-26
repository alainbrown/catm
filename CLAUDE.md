# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**catm** is a 100% in-browser long-form text-to-speech reader. All synthesis runs locally — the Kokoro 82M TTS model is downloaded once into the browser's HTTP cache and run via ONNX Runtime Web (WebGPU with WASM fallback). There is no server. The app is an installable PWA that, once visited and the model is fetched, works fully offline. Deploys to GitHub Pages from `main`.

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173
- `npm run build` — typecheck (`tsc -b`) + `vite build` to `dist/` (the PWA at catm-app.github.io)
- `npm run build:ext` — typecheck + `vite build --mode extension` to `extension/app/` (the bundled extension app; gitignored)
- `npm run build:all` — both of the above
- `npm run lint` — Biome check (lint + format diff). `npm run format` to autoformat.
- `npm test` — full suite: Vitest unit tests then Playwright e2e. This is the verification command; always run it whole. `npm run test:unit` runs only Vitest (node env, `src/**/*.test.ts{,x}`); `npm run test:unit:watch` for watch mode; notable suites: `src/textChunk.test.ts` (highlight chunker) and `src/worker/splitToFit.test.ts` (phoneme-token splitter). `npm run test:e2e` runs only Playwright (Chromium only, single worker, 5-min test timeout, reuses an existing dev server on :5173). Single specs (e.g. `npx vitest run src/textChunk.test.ts`, `npx playwright test -g "synth saves session"`) are fine for iterating on a failure but never sufficient for verifying a change.
- `npm run icons` — regenerate the PNG icon set (192/512/maskable/apple-touch) from `public/favicon.svg` via `scripts/generate-icons.mjs` (sharp). Run after touching the SVG and commit the outputs.

Playwright launches Chrome with `--enable-features=SharedArrayBuffer` — needed so the worker can run ONNX. If you change the e2e harness, preserve that flag.

**Always run the full test suite. There are no valid subsets.** `npm test` runs unit + e2e together — that is the verification command. Do not run a single spec file ("hello-world only", "the fast one") and report that as verification; that is a skipped test, not a fast test.

## Architecture

The app is one React surface (`src/App.tsx`) that owns nearly all state and drives a Web Worker for TTS plus an OPFS-backed HLS session store for audio.

### Three storage layers

1. **`localStorage`** — onboarding flag (`catm:onboarded`), voice preference (`catm:voice`), playback speed (`catm:speed`).
2. **IndexedDB (`catm` DB, store `sessions`)** — session metadata (`SessionMeta`: id, title, sourceText, duration, voice, plus `chunkDurations`/`chunkTexts` used by `ReaderView` to highlight the source text as audio plays). Schema is at `DB_VERSION = 6`; **upgrades drop the store and wipe OPFS — there is no migration path**. Bumping the version is a data-loss operation by design (the HLS layout replaced an earlier single-mp4 layout).
3. **OPFS (`sessions/<id>/`)** — per-session audio as HLS: `init.mp4`, `seg-N.m4s` fragments, and a live `playlist.m3u8`. The Kokoro model weights themselves live in the browser's HTTP cache (Cache Storage), not OPFS.

`src/storage/sessionStore.ts` is the single entry point for both IDB and OPFS.

### Synthesis pipeline (progressive HLS)

The full source text is posted to the worker in one message; the worker streams it out sentence-by-sentence using kokoro-js's `TextSplitterStream`, then further splits each sentence to fit Kokoro's 510-phoneme-token input cap (`splitToFit` in `src/worker/splitToFit.ts`, measured via `phonemizer` + the model's own tokenizer). The flow:

1. App posts `synth-start` → `synth-text` (one message carrying the full text) → `synth-end` to `src/worker/kokoro.worker.ts`. `synth-cancel` is processed out-of-band (see concurrency invariant).
2. The worker iterates sentences, calls `KokoroTTS.generate()` per piece, and feeds PCM into `ProgressiveEncoder` (`src/hls/encode.ts`), which upsamples 24 kHz → 48 kHz (linear 2×, valid since the source is band-limited) and AAC-encodes into fragmented MP4 via WebCodecs `AudioEncoder` + `mp4-muxer`'s `StreamTarget`. One emitted sentence = one `chunk-encoded` event back to the App carrying that sentence's text + duration, which is what gets persisted as `chunkTexts`/`chunkDurations`.
3. The encoder emits a single `init.mp4` then one `seg-N.m4s` per sentence back to the main thread, which writes them to OPFS and rewrites `playlist.m3u8` after every segment (PLAYLIST-TYPE `EVENT`, no `ENDLIST` until finalised). Playback isn't mounted until at least `PLAYBACK_BUFFER_SEGMENTS` (3) segments exist, so hls.js's first playlist read prefetches a useful window.
4. `ReaderView` attaches `hls.js` to an `<audio>` element via a custom `OpfsLoader` (`src/hls/playback.ts`) that resolves `opfs://{sessionId}/{filename}` URLs against `readSessionFile`. hls.js's normal EVENT-playlist reload cadence handles the live append.

`src/textChunk.ts` is **not** in the synthesis path — it's used only by `ReaderView` (`locateChunks`) to map `audio.currentTime` back onto the source text for highlight rendering, using the persisted `chunkTexts`/`chunkDurations`.

### Worker structure

The worker is split into two layers:

- **`src/worker/workerProtocol.ts`** — a pure, browser-API-free state machine (`createHandlers`) that owns the `InMsg`/`OutMsg` protocol, the serialised `workQueue`, and the `cancelledTxnIds`/`erroredTxnIds` bookkeeping. Dependencies (load, synthesize, stream, createEncoder, post) are injected, so it's unit-testable under Vitest's node env.
- **`src/worker/kokoro.worker.ts`** — the actual `Worker` entrypoint. Wires the state machine to `KokoroSynthesisClient` (`src/worker/synthesisModel.ts`, the kokoro-js wrapper that owns model load + sentence streaming) and `ProgressiveEncoder`, and posts `ready`/`progress`/`error` back to the App.

### Worker concurrency invariant

`workerProtocol.ts` serialises all incoming messages onto a single promise chain (`workQueue`). This is load-bearing: Chrome dispatches messages while the previous handler awaits, and without the chain a `synth-text` resume could race a later `synth-end` tearing down the encoder. `synth-cancel` is the **only** message that bypasses the queue — it must, otherwise cancel would sit behind the very chunks it's trying to abort. Do not parallelise the handler.

### Worker boot, devices, progress

The worker picks `device: "webgpu"` when `navigator.gpu` exists, otherwise `wasm`; the default dtype is `fp32`. The worker starts at mount and posts a `warmup` to load the model. Progress events from kokoro-js are forwarded raw; the App aggregates per-file `{loaded, total}` into a single download bar, and the first `ready` after a fresh install flips `catm:onboarded` in localStorage. "Delete everything" (the reset action, confirmed via a single `ConfirmDialog`) terminates the worker, purges any Cache Storage keys containing `kokoro`/`transformers`/`hf` (and the `catm-model-v1` cache), wipes IDB sessions + OPFS audio, clears the onboarding/voice prefs, and restarts the worker so the model re-downloads.

### Voice preview vs. full read

`type: "synth"` is a one-shot path used only by the voice-preview chip — it returns raw PCM, which the main thread encodes with `encodePcmToCompleteMp4` (the non-streaming sibling of `ProgressiveEncoder`) for a quick `<audio>` blob. The full read path uses the `synth-start` / `synth-text` / `synth-end` streaming protocol described above.

### App-level state shape

`App.tsx` holds `status: AppStatus` (a discriminated union — `first-launch | loading | downloading | ready | synthesising | error`) and `doc: DocState` (current draft/loaded session). `modified` is derived: text differs from `savedText`, OR the saved audio's voice differs from the currently selected voice (changing voice invalidates audio). Navigating away from a modified doc opens `DiscardDialog`.

### PWA layer

The app is a real installable PWA. Three pieces own this:

- **`public/manifest.webmanifest`** — installable metadata. `display: standalone`, dark `theme_color`, per-size PNG icons (incl. a dedicated maskable variant), `share_target` (GET `title`/`text`/`url`), `file_handlers` for `.txt`/`.md`, `launch_handler: navigate-existing`.
- **`src/sw.ts`** (bundled by `vite-plugin-pwa` in `injectManifest` mode to `dist/sw.js`) — does four jobs: (1) inject COOP/COEP/CORP headers on every response so the page becomes `crossOriginIsolated` (required for SharedArrayBuffer / threaded WASM on GitHub Pages, which can't set the headers itself); (2) precache the app shell from the Workbox manifest; (3) cache-first the Kokoro model weights from huggingface.co into `catm-model-v1`; (4) serve the cached `index.html` as a navigation fallback when the network is unreachable. The SW does **not** call `skipWaiting()` itself — see update flow below.
- **`src/main.tsx`** — registers the SW (PROD only), reloads once on first install so the page reloads with COI headers, listens for waiting workers, dispatches `catm:update-ready`, and reloads on `controllerchange`. It also polls `reg.update()` every 30 min and on `visibilitychange→visible` so long-lived reader tabs notice new deploys.

#### SW update flow

A new deploy installs silently. `<UpdateBanner>` (`src/pwa/UpdateBanner.tsx`) listens for `catm:update-ready` and shows a prompt; on confirm it posts `{ type: "SKIP_WAITING" }` to the waiting worker. The SW's message handler calls `skipWaiting()`, which fires `controllerchange`, and `main.tsx` reloads exactly once. **Do not move `skipWaiting` back into the SW's `install` handler** — it would tear down the controller mid-synthesis.

#### External ingest

`share_target` and `file_handlers` both feed `src/pwa/ingest.ts`:

- `consumeShareTarget()` reads `?title=&text=&url=` from `location.search` once on mount, then strips them via `history.replaceState` so a reload doesn't re-import.
- `onFileLaunch()` subscribes to `window.launchQueue` and reads the dropped `FileSystemFileHandle`(s).

Both surfaces only ingest into an **empty draft** (`doc.id === null && doc.sourceText === ""`). Otherwise the launch is dropped silently to avoid clobbering unsaved work.

#### iOS specifics

`index.html` sets `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style=black-translucent` so dark mode reads correctly in the standalone PWA. `body` carries `env(safe-area-inset-*)` padding and `.shell` uses `min-height: calc(100dvh - top - bottom)` so a single viewport still fits without forcing a scroll.

### Extension build

`extension/` is a Chrome MV3 extension that bundles the same React app and renders it inside Chrome's side panel.

- **Two builds, one source tree.** `vite build` produces the PWA in `dist/`. `vite build --mode extension` produces `extension/app/` (gitignored). The PWA plugin is gated off in extension mode (no SW — the manifest sets COOP/COEP directly), and a couple of runtime paths are mode-gated via `src/runtime.ts` (`IS_EXTENSION` from `import.meta.env.MODE`, `IS_SIDE_PANEL` from `?ctx` not being `tab`).
- **Manifest** (`extension/manifest.json`) declares `side_panel.default_path = "app/index.html"`, `sidePanel` permission, CSP `"script-src 'self' 'wasm-unsafe-eval'"`, and COOP/COEP keys so the page is `crossOriginIsolated` without needing the PWA's header-injecting SW. **No `host_permissions`** — the extension never touches `catm-app.github.io`.
- **Background SW** (`extension/background.js`) calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` so the toolbar icon opens the panel, and registers a `"Read it to me"` context menu. On menu click it calls `chrome.sidePanel.open({ windowId })` **synchronously before** any await, then writes the selection to `chrome.storage.session` under `catm:pending-share`. Awaiting before `sidePanel.open` consumes the user gesture and the panel stays closed — preserve the ordering.
- **Side-panel ingest** (`src/pwa/extensionIngest.ts`) drains `chrome.storage.session["catm:pending-share"]` on mount and subscribes to `chrome.storage.onChanged` so a menu fire while the panel is already open still ingests live. Replaces the old PWA-side `bridge.js` content-script handoff entirely.
- **WebGPU in MV3.** In extension mode the worker configures `@huggingface/transformers`'s env *before* loading Kokoro:
  - `env.backends.onnx.wasm.numThreads = 1` — multi-threaded WASM spawns Emscripten pthread workers via `blob:` URLs; MV3 forbids `blob:` in `script-src`.
  - `env.backends.onnx.wasm.proxy = false` — the proxy worker also spawns via `blob:`.
  - `env.backends.onnx.wasm.wasmPaths = undefined` — defaults to a jsDelivr CDN URL; MV3 forbids remote scripts. `undefined` makes ORT use the bundled wasm shipped under `extension/app/assets/`.
  Same pattern used by `tantara/transformers.js-chrome` in production. WebGPU otherwise works the same way it does in the PWA.
- **Model cache.** No SW means no `catm-model-v1` Cache Storage interception; instead `src/worker/modelCache.ts` patches `globalThis.fetch` inside the worker to do the same cache-first routing for `huggingface.co` URLs. Same bucket name (`catm-model-v1`) so the offline-after-first-download invariant holds.
- **Side-panel layout.** Top-to-bottom: sticky `.panel-brandbar` (catm logo + name + live WebGPU/WASM device chip + popout button) → `<main>` (untouched ReaderView) → full `<Rail>` (sessions, perf, model, storage, reset). CSS `order` on `.shell-panel` reorders the desktop rail-then-main into brand-then-main-then-rail. The Rail's internal `.brand` is hidden in panel mode to avoid duplicating the brandbar.
- **Popout to tab.** `<PopoutButton>` in the brandbar (only rendered when `IS_SIDE_PANEL`) calls `chrome.tabs.create({ url: chrome.runtime.getURL("app/index.html?ctx=tab") })` then `window.close()`. Same origin as the panel → shared OPFS/IDB/model cache; the `window.close()` ensures only one view at a time, no IDB race. The tab renders the full desktop shell (rail beside main).

## Conventions

- **TypeScript is strict** with `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`. Type-only imports must use `import type`.
- **Biome** is the linter/formatter (2-space, double quotes, semicolons, 100-col). `noNonNullAssertion` is off; `noExplicitAny` is a warning.
- **Fonts are self-hosted** via `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` (imported in `src/main.tsx`). The family names are `"Inter Variable"` / `"JetBrains Mono Variable"`; legacy `"Inter"` / `"JetBrains Mono"` stay in the stack as fallbacks. No Google Fonts at runtime.
- Tests live next to source as `*.test.ts(x)`. Vitest runs in `node` env — anything browser-specific (Web Workers, OPFS, WebCodecs, hls.js) is **not** unit-testable here; cover it in Playwright e2e instead.
- E2E philosophy (from user memory): drive real user journeys end-to-end; do not write shell-loaded smoke tests, do not mock the worker or storage.
- `vite.config.ts` excludes `onnxruntime-web` and `kokoro-js` from dep optimisation and sets `worker.format: "es"` — needed for the ESM worker + WebGPU shaders to load correctly. The PWA plugin's `globPatterns` includes `png` and `woff2` so icons and self-hosted fonts make it into the precache. Don't change these without testing the worker boot path and offline launch.
- `base: "./"` in vite config produces relative asset URLs so the GitHub Pages deploy works under a subpath.
