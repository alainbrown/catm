# Stack — catm

*Last reviewed: 2026-05-21.*

The full technical stack. Choices are marked **decided** where the PRD or research has closed the question, and **proposed** where this document is making the determination subject to revision. Migration conditions are documented in-section where they apply.

Architectural principle: one ML runtime, one source language, one bundler, one ML acceleration backend. Fewer integrations reduce failure modes and bundle size.

---

## Summary

| Layer | Choice |
|---|---|
| Language | TypeScript (strict) |
| Framework | React 19 + Vite (no Next.js / no SSR) |
| Router | React Router (data router, hash routes for the extension) |
| Bundler | Vite |
| Styling | Plain CSS + CSS variables (no Tailwind) |
| State | React built-ins (`useState`, `useReducer`, Context); Zustand if cross-component sharing gets painful |
| ML runtime | ONNX Runtime Web |
| Segmenter | `sat-3l-sm` (wtpsplit) |
| TTS | Kokoro 82M (Low tier) |
| Audio encode | WebCodecs `AudioEncoder` |
| Audio container | fragmented MP4 + HLS playlist |
| Audio playback | hls.js + `<audio>` |
| Binary storage | OPFS (Origin Private File System) |
| Metadata storage | IndexedDB (via `idb`) |
| PWA shell | `vite-plugin-pwa` (Workbox) |
| Extension | Manifest V3, same codebase |
| Testing | Vitest (unit), Playwright (e2e) |
| Lint + format | Biome |
| Package manager | pnpm |
| Hosting | GitHub Pages |
| CI | GitHub Actions |
| License | MIT |

---

## Frontend

### Language — TypeScript (strict) [proposed]

Required for a project of this surface area. `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. The code interacts with binary buffers, OPFS handles, and MediaSource APIs; static type checking is essential to catch undefined-access defects before runtime.

### Framework — React 19 + Vite [decided]

A mature, widely-known choice. Familiar to most engineers, low onboarding cost for contributors in an open-source project, deep ecosystem for tooling and integrations. Approximately 45 KB compressed for React and ReactDOM before application code, which is a bundle cost relative to Svelte or Solid, but contributor accessibility outweighs the size delta.

**No Next.js, no Remix, no SSR.** catm is a static PWA; there is no server-side renderer. Vite, React, and React Router are the appropriate components.

**Migration contingency.** If the bundle budget or per-frame scrub-bar reactivity becomes a constraint, the lowest-cost migration is **Preact** (approximately 3 KB, React-compatible API, drop-in for most components). A migration to Svelte or Solid would be more invasive; consider only if Preact does not close the gap.

### Styling — plain CSS plus CSS variables [decided]

The mocks specify a custom visual identity (risograph palette, custom panels, shadows, halftones). A utility-class CSS framework would conflict with the design rather than support it. `shell.css` in `mocks-v3/` is the reference pattern: CSS variables for the palette, panel primitives, single typographic system.

Each React component carries a colocated CSS module (`Foo.module.css`) for scoped styles. Shared design tokens are defined in a single `app.css` imported at the root.

### State — React primitives, Zustand as fallback [proposed]

For component-local state: `useState`, `useReducer`, `useSyncExternalStore` (subscribing to playback engine tick events without re-rendering sibling components on every frame).

For cross-component state — current session, library list, settings — adopt **Zustand** if Context API usage becomes unwieldy: atomic stores, no provider components, approximately 1 KB. Not adopted preemptively. Initial implementation uses Context plus reducers; migrate to Zustand when a third component requires read access to the same store.

Two background subsystems own state and expose subscriptions:
- The **playback engine** owns `{position, prepared, status}` and emits updates consumed by the scrub bar via `useSyncExternalStore`.
- The **session store** is the IndexedDB-backed library; reads are pull queries, writes invalidate consumers.

---

## ML runtime

### `onnxruntime-web` [decided]

Loads both Kokoro and SaT. WebGPU execution provider preferred, WASM fallback automatic. See [RESEARCH.md](./RESEARCH.md) for the segmenter discussion.

### Tokeniser

For SaT we use the model's own (SentencePiece). For Kokoro we use whatever phonemiser it ships with. We do **not** add a separate tokenisation library — the model's tokenizer is part of the model artifact.

### Worker isolation

ML inference runs in a **dedicated Web Worker**, not on the main thread. The main thread owns the editor, scrub bar, and UI; the worker owns SaT, Kokoro, and the audio encoder. Posts are typed messages, not raw `postMessage`.

---

## Audio pipeline

### Encoding — WebCodecs `AudioEncoder` [decided]

PCM from Kokoro → `AudioEncoder` (Opus, configurable bitrate, default 64 kbps) → encoded chunks.

**Opus over AAC.** Better quality at low bitrates; on a Chromium-only target, browser support is native. AAC is the canonical HLS codec but Opus is supported in modern HLS specs and gives us ~20% better quality at the same size.

### Muxing — fragmented MP4 [decided]

Encoded Opus chunks are wrapped into fMP4 segments (`.m4s`). [`mp4box.js`](https://github.com/gpac/mp4box.js/) provides the muxer; it is a mature library with no native-only dependencies.

### Index — local HLS playlist [decided]

A `.m3u8` playlist is generated per session and extended as the synthesis pipeline emits new segments. The playlist is in event mode while synthesis is in progress (`#EXT-X-PLAYLIST-TYPE:EVENT`) and transitions to VOD on completion (`#EXT-X-ENDLIST`).

### Playback — hls.js plus `<audio>` [decided]

Chromium does not provide native HLS playback; [hls.js](https://github.com/video-dev/hls.js) supplies it via MSE. A Blob URL referencing the playlist is supplied to hls.js, which fetches segments through a custom loader backed by OPFS.

The `<audio>` element handles play, pause, and seek natively; the scrub bar UI is synchronised with `audio.currentTime` events.

---

## Storage

### OPFS — binary segments [decided]

Origin Private File System for the fMP4 segments. OPFS is designed for binary blob storage and provides higher throughput than IndexedDB for this access pattern. Per-session directory: `/sessions/{session_id}/segments/{idx}.m4s` and `/sessions/{session_id}/playlist.m3u8`.

### IndexedDB — session metadata [decided]

Via [`idb`](https://github.com/jakearchibald/idb) — small typed wrapper around IndexedDB. Stores:
- Session records: `{id, title, source_text, created_at, last_position, finished_at, duration, voice}`
- Search index for Library
- Reverse lookup `chunk_id → session_id` for audit / debugging

### Models — fetched from HuggingFace, cached in OPFS [decided]

Both model artifacts are fetched **directly from HuggingFace** on first run and then cached in OPFS for offline use:

- Kokoro: `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/{sha}/...`
- SaT: `https://huggingface.co/ModelCloud/sat-3l-sm-int8-onnx/resolve/{sha}/...` (or the equivalent SaT ONNX repository)

Both licenses are permissive (Kokoro: Apache 2.0; SaT and wtpsplit: MIT) and HuggingFace's resolve URLs are served with permissive CORS headers, permitting direct browser fetches.

Artifacts are **pinned by commit SHA**, not branch, eliminating the possibility of an upstream file change reaching users without an explicit version bump. A `models.json` manifest declares the expected SHA-256 of each artifact; bytes are verified after download and corrupted or substituted artifacts fail closed.

**Documented trade-off.** First-run availability is coupled to HuggingFace uptime, and HuggingFace's request logs observe the user's first-visit IP address and User-Agent header. The privacy guarantee ("nothing leaves your device") remains accurate for user *content*, but the model-fetch path issues outbound requests to a third-party origin. For v1, the implementation simplicity is preferred. Contingency: mirror the pinned SHA artifacts to object storage (e.g. Cloudflare R2) and update the URLs in `models.json`; this requires migrating the host, as GitHub Pages does not serve the approximately 80 MB Kokoro artifact efficiently.

### localStorage — preferences and draft [decided]

Default playback speed, selected voice, theme (when implemented), and the most recent editor draft. Small values requiring synchronous access that must survive reloads.

---

## PWA + extension

### Service worker — `vite-plugin-pwa` [proposed]

Workbox under the hood. Strategy:
- App shell: `precacheAndRoute` — fully offline after first visit
- Model files: cached on first download, served from OPFS thereafter
- HTML routing: network-first then offline fallback to the shell

### Web app manifest [decided]

`name`, `short_name: "catm"`, `display: standalone`, `theme_color` matched to the riso palette, masked + adaptive icons.

### Extension — Manifest V3, shared codebase [decided]

`manifest.json` in a sibling Vite entry. The same `src/` is consumed for all code apart from the extension-specific shell:

- `entries/extension/background.ts` — extension service worker (context menu registration, keyboard shortcut, offscreen-document lifecycle)
- `entries/extension/sidepanel.html` and `sidepanel.tsx` — the side panel UI (imports the same React components as the PWA)
- `entries/extension/offscreen.html` — sustains audio playback when the side panel is closed

`host_permissions: ["https://catm.app/*"]` for shared-origin persistence with the PWA.

---

## Build, dev, test

### Bundler — Vite [decided]

Fast HMR for the Worker, main thread, and React components. Vite supports Workers natively (`new Worker(new URL('./worker.ts', import.meta.url))`).

### Package manager — pnpm [proposed]

Strict dependency resolution, fast installs, content-addressable store. Standard for current contributor expectations.

### Lint and format — Biome [proposed]

A single tool for both. Faster than ESLint plus Prettier and easier to maintain in a small repository. ESLint plus Prettier is a drop-in replacement if preferred; the choice does not affect other components.

### Tests

- **Vitest** for unit and integration tests — chunker logic, playlist generator, scrub-bar arithmetic.
- **Playwright** for end-to-end tests — drives Chromium, pastes text, invokes Read, asserts audio playback. Required because the product is the audio pipeline and end-to-end validation requires a real browser.

ML model behaviour is not unit-tested. Tests assert the surrounding code paths; the models are treated as opaque components validated by the end-to-end suite.

---

## Hosting + CI

### Hosting — GitHub Pages [proposed]

Static hosting, free, colocated with the source repository. The application shell is small; the large model artifacts are fetched from HuggingFace rather than the origin, so GitHub Pages' 100 GB/month bandwidth soft limit and 1 GB repository limit are not constraints for v1.

**Documented trade-offs:**
- No automatic per-PR preview deployments — production URL only, plus any branch URLs configured via Actions.
- Slower global CDN than Cloudflare or Vercel; acceptable for an application served primarily from the service worker after first load.
- No rollback UI; rollbacks are performed by `git revert` and redeployment.

**Migration triggers.** Move to Cloudflare Pages (with R2 for model artifacts) or Vercel if (a) the 100 GB bandwidth limit is approached, or (b) per-PR previews become required for the review process.

### CI — GitHub Actions [proposed]

Workflow:
- On pull request: `pnpm install && pnpm lint && pnpm test && pnpm build`
- On merge to `main`: the above plus GitHub Pages deployment
- On tag: the above plus production of a Chrome Web Store submission archive

Chrome Web Store submission is performed manually for v1; the store review process is not justified to automate at this scale.

---

## Repository layout

```
catm/
├─ PRD.md
├─ RESEARCH.md
├─ STACK.md
├─ mocks/                    # round-1 design explorations
├─ mocks-v2/                 # round-2
├─ mocks-v3/                 # round-3 (current direction)
├─ src/
│  ├─ app.css                # shared design tokens
│  ├─ main.tsx               # PWA entry
│  ├─ App.tsx                # root component + router
│  ├─ lib/
│  │  ├─ chunker/            # SaT integration
│  │  ├─ tts/                # Kokoro integration
│  │  ├─ audio/              # WebCodecs + fMP4 + HLS playlist
│  │  ├─ storage/            # OPFS + IndexedDB
│  │  └─ ui/                 # React components (.tsx + .module.css)
│  ├─ routes/                # React Router route components
│  ├─ worker/                # inference worker
│  └─ entries/
│     └─ extension/          # MV3 extension shell (background, sidepanel, offscreen)
├─ public/                   # PWA assets, manifest, icons
├─ tests/
│  ├─ unit/                  # vitest
│  └─ e2e/                   # playwright
├─ index.html                # PWA entry HTML
├─ package.json
├─ vite.config.ts
├─ biome.json
└─ tsconfig.json
```

---

## Excluded from the stack

- **No backend.** No Node server, no edge functions, no proxy. catm is a static site post-first-load.
- **No analytics, telemetry, or error reporting.** PRD §Privacy is binding.
- **No component library.** The visual design is custom; off-the-shelf UI kits would conflict with the design system.
- **No CSS framework.** Same rationale.
- **No state management library by default.** React primitives (`useState`, `useReducer`, `useSyncExternalStore`, Context) cover v1; Zustand is reserved as a contingency for cross-component state.
- **No secondary ML framework.** ONNX Runtime Web exclusively. (See RESEARCH.md for the rationale against WebLLM.)
- **No secondary WebGPU context.** Implied by the above.
- **No native mobile application.** PRD non-goal.
