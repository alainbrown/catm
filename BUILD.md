# Build plan — catm

*Last reviewed: 2026-05-21.*

The build sequence from empty repository to MVP release. Each milestone is a self-contained checkpoint terminating in an executable artifact. The sequence is layered: each milestone adds one capability on top of the previous.

The technology choices in STACK.md are established for 2026: Kokoro inference in the browser via ONNX Runtime Web is a documented integration path (`kokoro.js`), WebGPU is Baseline across target browsers, hls.js plus Opus-in-fMP4 is supported in Chromium, and Kokoro is designed for incremental long-form synthesis. The milestones below are execution work, not feasibility evaluation.

Companion to [PRD.md](./PRD.md), [STACK.md](./STACK.md), [RESEARCH.md](./RESEARCH.md). This document specifies sequencing; those documents specify requirements and implementation.

---

## Principles

1. **End-to-end before feature-complete.** A minimal implementation of the full pipeline (text → audio → playback → storage) is integrated before any single component is optimised.
2. **Production inference from M1.** No stubs of the ML pipeline. The pipeline is the product; substituting a placeholder defers integration cost.
3. **PWA before extension.** The PWA is the primary surface; the extension is a secondary embedding of it. PWA is built first.
4. **One milestone, one executable demonstration.** Each checkpoint produces an artifact a user can exercise. A milestone without a demonstration is incomplete.

---

## Milestones

### M1 — Hello world: text in, audio out

Smallest end-to-end slice of the inference pipeline. A single short utterance is synthesised by Kokoro in the browser and played through the default audio element. No chunking, no streaming container, no HLS, no persistence, no UI polish — just proof that the model runs and emits audible speech from arbitrary input text.

- Repository bootstrap: Vite, React 19, TypeScript strict, Biome, Vitest, Playwright, GitHub Actions, GitHub Pages deployment, `app.css` design tokens
- Kokoro 82M loaded from HuggingFace via ONNX Runtime Web in a dedicated Worker, WebGPU execution provider with WASM fallback
- Minimal page: a `<textarea>`, a "Speak" button, an `<audio>` element
- Pipeline: text → Kokoro inference on the full input as one batch → raw PCM → WAV `Blob` → object URL → `<audio>.play()`

**Demonstration:** on the deployed URL, entering *"Hello world"* and pressing Speak plays the synthesised utterance through the device's default output. Arbitrary short inputs (a sentence or two) work identically.

---

### M2 — Progressive long-form synthesis and playback

Chunked, streaming pipeline that handles long-form input without the user waiting for full synthesis. Replaces M1's single-buffer path with the production streaming architecture.

- `sat-3l-sm` loaded in the same Worker for sentence segmentation and length-constrained batching
- Pipeline upgrade: text → SaT batches → Kokoro inference → WebCodecs `AudioEncoder` (Opus) → `mp4box.js` fMP4 segments → live `.m3u8` playlist
- hls.js attached to the `<audio>` element with a custom segment loader; three-region scrub bar (played / prepared / unprepared)

**Demonstration:** a 12,000-word input on the deployed URL produces audio within approximately 3 seconds of submission and plays through to completion without inter-segment discontinuities. Backward seeks resolve immediately; forward seeks into the unprepared region block until synthesis catches up.

---

### M3 — Persistence and offline operation

Storage, Library, and PWA shell are integrated together because offline operation depends on persisted artifacts.

- OPFS layout: `/sessions/{id}/segments/{idx}.m4s`, `/sessions/{id}/playlist.m3u8`
- IndexedDB via `idb`: session records (id, title, source text, position, duration), search index
- Library tab: reverse-chronological list, incremental rendering, row schema defined in PRD §Library, resume-or-restart selection rule, single and bulk deletion
- `vite-plugin-pwa`: precache application shell, OPFS-backed model cache, offline fallback route
- Web application manifest, placeholder icon assets, first-run flow with voice download progress and privacy notice
- Storage-utilisation display in Library header and Settings

**Demonstration:** three sessions synthesised, the tab closed, the network disabled, the PWA reopened from the installed launcher — three sessions appear in Library at their persisted positions; a new session synthesises and plays without network access.

---

### M4 — UI completion and extension integration

The PWA UI matches PRD §UI in full, and the browser extension is implemented against the shared codebase.

- Playback UI from `mocks-v3/`: editable title, ±30s controls, play/pause, Stop, speed selector, empty and loading states, storage-pressure banner
- Settings tab: voice tier selector (Low enabled; Medium and High labelled "Coming soon"), storage display with clear-all action, About panel
- Library search across title and body
- Second Vite entry for the extension: Manifest V3, side-panel API, background service worker, offscreen document for background audio
- Context menu entry "Read with catm", toolbar action opens side panel, user-configurable keyboard shortcut
- Welcome tab on extension installation: product description, background voice download

**Demonstration:** PRD §"Detailed user journeys" (Journey 1, Journey 2, Journey 3) reproduce step-for-step on the deployed PWA and installed extension.

---

### M5 — Hardening and release

- Malformed-input fuzz coverage: high-emoji density, punctuation runs, mixed-script input, single sentences exceeding 50,000 characters
- Per-batch failure isolation: synthesis errors skip the affected batch, are logged, and synthesis proceeds
- Slow-device fallback: absent WebGPU or low real-time factor triggers a one-time notice and continues in WASM mode
- Background-audio interruption: clean session termination with position persisted
- Non-English input detection: short-circuit with the message *"Nothing to read aloud here — the current voice speaks English only"*
- Storage-quota proximity banner
- Playwright e2e suite: happy path plus the reliability cases above; the 45-minute continuous-session test on the lowest-specification target laptop
- v1.0.0 tag; CI produces a Chrome Web Store submission archive; submission filed
- Public README, beta feedback channel operational, beta cohort exercises the three journeys

**Exit criteria:** PRD §"Reliability requirements" satisfied. PRD §"Success criteria" 1–5 measurable on at least 10 beta participants; no participant cites voice quality as the cessation reason.

---

## Out of scope for this plan

- **Medium and High tiers.** Post-MVP, per RESEARCH.md. Tier selector exposes them as "Coming soon" from M4 onward.
- **Read-along (per-word highlighting).** PRD stretch goal.
- **Per-PR preview deployments.** GitHub Pages constraint accepted; migrate to Cloudflare Pages if previews become required for review.
- **Telemetry, analytics, crash reporting.** PRD §Privacy is binding.
- **Mirroring model artifacts off HuggingFace.** Contingency documented in STACK.md; triggered only on HuggingFace availability or privacy-posture regression.
- **Firefox and Safari support.** PRD non-goal for v1.

---

## Sequence

```
M1 → M2 → M3 → M4 → M5
```

Strict dependency order. M1 emits audio from arbitrary text via the smallest viable pipeline; M2 upgrades to chunked progressive synthesis for long-form input; M3 persists sessions and enables offline operation; M4 completes the UI and adds the extension; M5 hardens and releases.
