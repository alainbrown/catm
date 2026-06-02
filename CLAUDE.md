# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**catm** is a 100% in-browser long-form text-to-speech reader, shipped as a Chrome extension. All synthesis runs locally — the Kokoro 82M TTS model is downloaded once into the browser's HTTP cache and run via ONNX Runtime Web (WebGPU with WASM fallback). There is no server.

`alainbrown.com/catm` is a **marketing landing page** (hand-written static HTML in `marketing/`) that points visitors at the Chrome Web Store. The runnable React app only ships inside the extension. Deploys to GitHub Pages from `main` via `.github/workflows/deploy.yml`.

## Commands

- `npm run dev` — Vite dev server on http://localhost:5173 serving the React app at `/`. Vite is **only** for the extension build pipeline; the marketing site has no dev story (it's pure static HTML, open `marketing/index.html` directly if you need to preview it).
- `npm run build` — typecheck + `vite build` (via `@crxjs/vite-plugin`) to `dist/` (the complete generated extension — manifest, service worker, side-panel app, icons; gitignored). The manifest is code (`manifest.config.ts`); crxjs uses the manifest's HTML refs (`src/sidepanel/index.html`) as build inputs. The extension is the only thing that gets built; the marketing site has no build step (see below).
- `npm run check:marketing` — `node scripts/check-marketing.mjs`. Verifies every relative href/src in `marketing/*.html` resolves to a file. Run automatically by `test.yml` before the test suite so a typo'd asset path fails the PR.
- `npm run lint` — Biome check (lint + format diff). `npm run format` to autoformat.
- `npm test` — full suite: Vitest unit tests then Playwright e2e. This is the verification command; always run it whole. `npm run test:unit` runs only Vitest (node env, `src/**/*.test.ts{,x}`); `npm run test:unit:watch` for watch mode; notable suites: `src/textChunk.test.ts` (highlight chunker) and `src/worker/splitToFit.test.ts` (phoneme-token splitter). `npm run test:e2e` runs only Playwright (Chromium only, single worker, 2-min cap for the test and every wait inside it, builds the extension first). The Playwright suite is intentionally one journey (`e2e/journey.spec.ts`) that drives the full onboard → synth → reload → replay → edit → delete flow; subdividing it defeats the purpose.

Playwright launches Chrome with `--enable-features=SharedArrayBuffer` — needed so the worker can run ONNX. If you change the e2e harness, preserve that flag.

**Always run the full test suite. There are no valid subsets.** `npm test` runs unit + e2e together — that is the verification command. The e2e suite is one journey on purpose; do not skip it or replace it with a unit-only run and call that verification.

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

### Marketing page

`marketing/` holds a hand-written static HTML page (no JS, no React) styled to match the app's aesthetic — same `radial-gradient` body background and dot-SVG overlay, same `c` brand mark, same gradient accents. Assets next to it (`favicon.svg`, `privacy.html`) are referenced with relative paths. **There is no build step** — `deploy.yml` uploads `marketing/` directly to GitHub Pages. `scripts/check-marketing.mjs` is a CI-only lint that verifies all relative refs resolve before the deploy fires. **`marketing/privacy.html`** documents the extension's (entirely local) data handling for the Chrome Web Store listing; do not delete it during cleanup.

### Extension build

catm is a Chrome MV3 extension — manifest-as-code via `@crxjs/vite-plugin`, built to `dist/` — that bundles the React app and renders it inside Chrome's side panel.

- **Single Vite project, manifest-driven inputs.** `src/sidepanel/index.html` is the React app entry, referenced by the manifest's `side_panel.default_path`. `@crxjs/vite-plugin` treats the manifest's HTML references as the build inputs and emits the complete extension into `dist/` — no `rollupOptions.input` override to maintain. `npm run dev` serves the panel at `/` for the e2e harness. The marketing build is outside Vite entirely (see above). `src/runtime.ts` exports a single `IS_SIDE_PANEL` flag derived from the URL (`chrome-extension:` protocol AND no `?ctx=tab`) — no build-mode flag is needed because the React app's only non-extension consumer is the dev harness.
- **Manifest** (`manifest.config.ts`, compiled by crxjs to `dist/manifest.json`) declares `side_panel.default_path = "src/sidepanel/index.html"`, `sidePanel` permission, CSP `"script-src 'self' 'wasm-unsafe-eval'"`, and COOP/COEP keys so the page is `crossOriginIsolated`. The version comes from `package.json` (`version: pkg.version`), so manifest and package can't drift. Permissions are `sidePanel`, `contextMenus`, `scripting`, `activeTab`, `storage`. **No `host_permissions`** — "Read page" injects its extractor under the `activeTab` grant a context-menu click provides, not a broad host permission.
- **Background SW** (`src/background/service-worker.ts`, bundled by crxjs) sets `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` (toolbar icon opens the panel) and registers a `"catm"` context-menu submenu with two children — **"Read selection"** (`contexts: ["selection"]`) and **"Read page"** (`contexts: ["page","selection"]`). Both open the panel via `chrome.sidePanel.open({ windowId })` **synchronously before** any await (awaiting first consumes the user gesture and the panel stays closed), then stash `{ text, play }` in `chrome.storage.session` under `catm:pending-read`. "Read selection" stages `{ text: info.selectionText, play: true }` (auto-synth). "Read page" runs `chrome.scripting.executeScript({ target, func: () => document.documentElement.outerHTML })` — a self-contained function that returns the page's HTML **directly** (no content script, no `?script` loader, no message round-trip) — and stages `{ html, play: false }`. The injected `func` only copies HTML out; **Readability runs in the side panel, not the page**, which is why there's no in-page Readability injection. `stage` is exposed on `globalThis.__catmStage` so e2e can drive panel delivery (and the panel's Readability extraction) without a real content tab; the `executeScript` copy-out itself has no automated coverage (needs a real tab + `activeTab`, which Playwright can't supply).
- **Side-panel read pickup** (`src/extensionRead.ts`) drains `chrome.storage.session["catm:pending-read"]` on mount and via `chrome.storage.onChanged`. For staged `html` it parses with `DOMParser` and runs `@mozilla/readability`'s `Readability.parse()` (using `textContent`, since the parsed doc isn't rendered; falling back to `article`/`main`/`body`); for staged `text` it uses it directly. `App.tsx` auto-synths when `play` is set (Read selection); otherwise the text lands for the user to trim and Generate (Read page).
- **WebGPU in MV3.** In extension mode the worker configures `@huggingface/transformers`'s env *before* loading Kokoro:
  - `env.backends.onnx.wasm.numThreads = 1` — multi-threaded WASM spawns Emscripten pthread workers via `blob:` URLs; MV3 forbids `blob:` in `script-src`.
  - `env.backends.onnx.wasm.proxy = false` — the proxy worker also spawns via `blob:`.
  - `env.backends.onnx.wasm.wasmPaths = undefined` — defaults to a jsDelivr CDN URL; MV3 forbids remote scripts. `undefined` makes ORT use the bundled wasm shipped under `dist/assets/`.
  Same pattern used by `tantara/transformers.js-chrome` in production.
- **Model cache.** `src/worker/modelCache.ts` patches `globalThis.fetch` inside the worker to do cache-first routing for `huggingface.co` URLs into the `catm-model-v1` Cache Storage bucket, so the offline-after-first-download invariant holds.
- **Side-panel layout.** Top-to-bottom: sticky `.panel-brandbar` (catm logo + name + live WebGPU/WASM device chip + popout button) → `<main>` (untouched ReaderView) → full `<Rail>` (sessions, perf, model, storage, reset). CSS `order` on `.shell-panel` reorders the desktop rail-then-main into brand-then-main-then-rail. The Rail's internal `.brand` is hidden in panel mode to avoid duplicating the brandbar.
- **Popout to tab.** `<PopoutButton>` in the brandbar (only rendered when `IS_SIDE_PANEL`) calls `chrome.tabs.create({ url: chrome.runtime.getURL("src/sidepanel/index.html?ctx=tab") })` then `window.close()`. Same origin as the panel → shared OPFS/IDB/model cache; the `window.close()` ensures only one view at a time, no IDB race. The tab renders the full desktop shell (rail beside main).

### Demo renderer

`demo/` is a sibling Remotion project that renders every demo/marketing asset. It is **not** part of the extension build — its own `package.json` / `node_modules`, never imported from `src/`. Renderer entry: `./demo/render.sh` (Docker-based; bakes Chrome Headless Shell + Linux libs into a `catm-demo-renderer` image so the host doesn't need them). `render.sh` (or `render.sh all`) renders to the gitignored `demo/out/` then `publish`es each artefact into its committed home — so a re-record never leaves an asset stale by hand:

- `docs/demo.gif` — README hero.
- `docs/store/*.png` — CWS store listing (`screenshot-1..5` scene stills + `marquee`/`promo-tile` tiles).
- `docs/youtube-master.mp4` + `docs/youtube-thumbnail.png` — the YouTube upload bundle. The video is a 1920×1080 16:9 master (the 1280×800 render pillarboxed with the brand background via ffmpeg); the thumbnail is 1280×720. **Not** deployed to Pages.
- `marketing/demo.mp4` + `marketing/demo-poster.png` — the landing-page `<video>` loop (native 1280×800) and its poster. These ship to GitHub Pages, so they must live in `marketing/`.

Two non-obvious dependencies in `src/` exist for the demo and must not be "cleaned up":

- **Runtime-free type modules.** `PerfState` lives in `src/types.ts` and `SessionMeta`/`StorageBreakdown` live in `src/storage/sessionTypes.ts` (re-exported by `sessionStore.ts` for callers). The demo bundle imports these as types — if you merge them back into `App.tsx` or `sessionStore.ts`, the demo bundle drags in idb/fflate/worker code at build time.
- **`VoiceChip` `forceOpen` prop.** Used only by the demo to render the picker visibly. Don't remove it.

Demo scenes (`demo/src/scenes/*.tsx`) reuse the real components from `../src/components/` via relative imports and load `../src/app.css` directly, so the visual identity tracks the app. Side-panel scenes use a flex layout (`article: flex 1` + `panel: width 420`) so the article reflows when the panel opens — mirrors Chrome's actual side panel behaviour. A single composition takes an `overlay` prop so the same scenes render both the README GIF (with copy overlays) and clean CWS stills via `--props='{"overlay":false}'`.

## Conventions

- **TypeScript is strict** with `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax`. Type-only imports must use `import type`.
- **Biome** is the linter/formatter (2-space, double quotes, semicolons, 100-col). `noNonNullAssertion` is off; `noExplicitAny` is a warning.
- **Fonts are self-hosted** via `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` (imported in `src/main.tsx`). The family names are `"Inter Variable"` / `"JetBrains Mono Variable"`; legacy `"Inter"` / `"JetBrains Mono"` stay in the stack as fallbacks. No Google Fonts at runtime.
- Tests live next to source as `*.test.ts(x)`. Vitest runs in `node` env — anything browser-specific (Web Workers, OPFS, WebCodecs, hls.js) is **not** unit-testable here; cover it in Playwright e2e instead.
- E2E philosophy (from user memory): drive real user journeys end-to-end; do not write shell-loaded smoke tests, do not mock the worker or storage. E2E specs `page.goto("/")` — the dev server serves the React app there.
- `vite.config.ts` sets `worker.format: "es"` so the ESM worker + WebGPU shaders load correctly. The extension build only overrides `outDir`. Don't add a `publicDir` or `rollupOptions.input` override — the marketing site lives in `marketing/` and is built outside Vite, and the React entry is just the default root `index.html`.
- `base: "./"` in vite config produces relative asset URLs so the GitHub Pages deploy works under a subpath.
