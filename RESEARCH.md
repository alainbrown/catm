# Research — model selection for catm

*Last reviewed: 2026-05-21.*

This document covers the two model selection decisions for catm:

- **Part 1** — the *paragraph batcher*: accepts raw text, returns paragraph-sized batches of sentences for TTS input.
- **Part 2** — the *TTS model* per tier (Low / Medium / High): accepts a batch of text, returns audio.

Both must execute in the browser, ideally on the same ONNX Runtime Web plus WebGPU stack, under permissive licenses. Both are subject to the PRD's per-tier resource budget — Kokoro Low is approximately 80 MB on disk and approximately 600 MB RAM during synthesis; that constrains all subsequent choices.

---

## Headline recommendations

| Component | Pick | Confidence | Notes |
|---|---|---|---|
| Paragraph batcher | **`sat-3l-sm`** (wtpsplit) | **High** | Shared across tiers; segmentation is independent of voice quality |
| Low TTS | **Kokoro 82M v1.0** | **High** | TTS Arena V2 ELO 1500 (45% win rate against the leaderboard). Highest-ranked open-weight model under 100M parameters. Browser plus WebGPU operation verified |
| Medium TTS | Chatterbox-Turbo 350M *or* CosyVoice 3 0.5B | **Medium** | Chatterbox is preferable on deployment readiness (official ONNX export, MIT, q4f16 variants). CosyVoice 3 is preferable on objective WER (1.68% test-en). Evaluation pending |
| High TTS | Qwen3-TTS 1.7B (Soundly INT4 ONNX) *or* Orpheus 1B | **Low** | Benchmarks favour Qwen3-TTS (1.24% WER test-en, state-of-the-art in published comparisons). Deployment ergonomics favour Orpheus 1B (smaller, Llama-3 quantisation path). Evaluation pending |

PRD changes implied: the Medium and High tier selections differ from the original PRD. The selections remain evaluation-dependent because the benchmark-leading candidate and the deployment-leading candidate diverge in both tiers. See §"Audio quality benchmarks" for the data driving these conclusions.

---

# Part 1 — paragraph batcher

**Objective.** Select a model that accepts raw text and returns batches of sentences with paragraph-level structure, each batch within a target token or character count, suitable as TTS input one batch per HLS segment.

## Recommendation

**`sat-3l-sm` from the wtpsplit / Segment-any-Text family.** Purpose-built for sentence and paragraph segmentation, distributed as ONNX, footprint a fraction of Kokoro's, predicts paragraph boundaries natively (both sentence-end and newline probabilities).

Since wtpsplit 2.2.0 (February 2026), the library supports **length-constrained segmentation with Viterbi (optimal) or greedy algorithms and configurable priors** (`uniform`, `gaussian`, `lognormal`, `clipped_polynomial`). Batching toward a target token count is a built-in operation; no separate JavaScript bin-packing implementation is required. The chunker pipeline reduces to a single call.

An LLM is not required for chunking. An LLM solves a more general problem at higher resource cost; a purpose-built segmenter is deterministic, smaller, faster to execute, and more testable.

If `sat-3l-sm` exceeds the evaluation resource budget, the fallback is `sat-1l-sm`. If higher segmentation quality is required, the upgrade is `sat-12l-sm` — identical API, identical runtime.

## Option A — wtpsplit / Segment-any-Text (SaT)

Purpose-built sentence-segmentation model from [`segment-any-text/wtpsplit`](https://github.com/segment-any-text/wtpsplit). Successor to nnsplit, trained on 85 languages, ONNX as a primary distribution format.

Library is at **2.2.1** (April 2025), with the **length-constrained segmentation** feature introduced in 2.2.0 (February 2026). The underlying SaT architecture is unchanged from the [EMNLP 2024 paper](https://aclanthology.org/2024.emnlp-main.665/); subsequent improvements are in runtime and API surface.

### Variants

| Model | Layers | English F1 | Multilingual F1 | Fit |
|---|---|---|---|---|
| `sat-1l-sm` | 1 | 88.5 | 84.3 | Smallest, baseline |
| `sat-3l-sm` | 3 | 93.7 | 89.2 | **Recommended.** Optimal speed/quality trade-off |
| `sat-6l-sm` | 6 | 94.1 | 89.7 | Diminishing quality returns |
| `sat-12l-sm` | 12 | 94.0 | 90.4 | Highest quality, largest |

An INT8-quantised ONNX export of `sat-3l-sm` is published at [`ModelCloud/sat-3l-sm-int8-onnx`](https://huggingface.co/ModelCloud/sat-3l-sm-int8-onnx). Pre-evaluation disk estimate: 50–80 MB.

### Rationale

- **Native paragraph boundary prediction** — sentence-end and newline probabilities produced in a single inference pass.
- **Length-constrained segmentation built-in** — `min_length`, `max_length`, Viterbi or greedy, configurable priors.
- **ONNX-native**, identical runtime to the TTS model.
- **Deterministic, offline-only execution** — simpler to test and cache than an LLM.

## Option B — small LLM (transformers.js)

Sub-1B-parameter instruction-tuned LLM prompted for chunking. **Not recommended** for this role.

| Model | Params | q4 size | Notes |
|---|---|---|---|
| `onnx-community/Qwen3-0.6B-ONNX` | 600 M | ~300 MB + ~2 GB runtime | Current small Qwen entry |
| `onnx-community/Qwen3.5-0.8B-ONNX` | 800 M | larger | Larger variant |
| `HuggingFaceTB/SmolLM2-360M-Instruct` | 360 M | ~250 MB | Earlier generation but small |
| `HuggingFaceTB/SmolLM3-3B` | 3 B | ~1.5 GB | Exceeds budget |
| `google/gemma-3-1b-it` | 1 B | ~700 MB | Doubles overall footprint |

Rejection criteria: 4× or greater Kokoro's size, non-deterministic output, slower per-token execution, and segmentation is precisely the constrained classification task a 200 M-parameter classifier was designed for.

## Option C — WebLLM

Separate browser LLM runtime from MLC. Higher throughput than transformers.js but introduces **two ML runtimes in the bundle and two WebGPU contexts**. Excluded unless the architecture moves to LLM-based segmentation.

## Option D — CharBoundary (alea-institute, April 2025)

Random forest, **0.6 MB ONNX file**, approximately 1 GB runtime RAM, F1 0.773 (versus SaT's 0.937), trained on legal-domain text. Quality and domain mismatch outweigh the disk-size advantage. Worth evaluating only as a fallback.

## Open questions for evaluation (chunker)

1. `sat-3l-sm` INT8 ONNX file size — verify.
2. Cold-load first-call latency.
3. RAM consumption during inference on a 12,000-word chapter.
4. Viterbi versus greedy length-constrained algorithm comparison.
5. Paragraph boundary quality on representative English long-form input.

---

# Part 2 — TTS tier selection (Low / Medium / High)

**Objective.** Select the three tier models catm exposes. Each must:

1. Execute in the browser via ONNX Runtime Web plus WebGPU (or WASM fallback).
2. Be distributed under a permissive license (Apache 2.0 or MIT preferred).
3. Achieve naturalness sufficient for 10+ minute reads (PRD Goal #1).
4. Fit within a per-tier resource budget — disk and RAM — disclosed to the user (per the PRD's tier card).

## Browser-deployable TTS landscape (May 2026)

Three shifts in the last 12 months:

- **Sub-100M-parameter models reached production-grade quality.** Kokoro at 82M established the threshold; [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) (~99M) and [MOSS-TTS-Nano](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M) (~100M) are the recent sub-100M entrants.
- **ONNX is now a baseline distribution format for new TTS releases.** Resemble AI publishes [`ResembleAI/chatterbox-turbo-ONNX`](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX) alongside the PyTorch artifact, with q4, q8, fp16, and q4f16 quantisation variants. CosyVoice 3, Voxtral, and Higgs Audio also publish ONNX exports.
- **WebGPU is universally available in target browsers.** Combined with [Transformers.js v4](https://huggingface.co/blog/transformersjs-v3)'s native WebGPU backend (February 2026), the execution substrate is stable.

Top trending TTS models on HuggingFace as of May 2026 (from the trending list):

| # | Model | Approx. params | License | Browser-ready? |
|---|---|---|---|---|
| 1 | `Supertone/supertonic-3` | 99 M | **OpenRAIL-M** | Yes — designed for on-device including browser |
| 2 | `ResembleAI/Dramabox` | ? | ? | Unclear |
| 3 | `Aratako/Irodori-TTS-500M-v3` | 0.5 B | ? | Japanese-focused |
| 5 | `k2-fsa/OmniVoice` | ? | ? | 2.19 M downloads — investigate |
| 6 | `hexgrad/Kokoro-82M` | 82 M | **Apache 2.0** | **Verified operational** (Xenova) |
| 9 | `Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice` | 2 B | Apache 2.0 | Marginal — requires aggressive quantisation |
| 10 | `openbmb/VoxCPM2` | ? | ? | Server-class as of this writing |
| 11 | `coqui/XTTS-v2` | — | Coqui PL | Earlier model, license restrictions |
| 12 | `ResembleAI/chatterbox` | 0.35 B | **MIT** | Yes — official ONNX |
| 13 | `mistralai/Voxtral-4B-TTS-2603` | 4 B | Apache 2.0 | Exceeds browser budget |
| 14 | `FunAudioLLM/Fun-CosyVoice3-0.5B-2512` | 0.5 B | Apache 2.0 | ONNX export exists; browser execution unverified |
| 15 | `OpenMOSS-Team/MOSS-TTS-Nano-100M` | 100 M | ? | Candidate for evaluation |

Also tracked: [Orpheus TTS](https://github.com/canopyai/Orpheus-TTS) (Apache 2.0), distributed in 150M, 400M, 1B, and 3B variants — relevant for the High tier because the 1B variant is a plausible browser-deployment candidate.

## Audio quality benchmarks

This section grounds tier selection in measurable data. **Caveat: the dataset is incomplete.** Open-weight TTS benchmarking in 2026 is fragmented. Leaderboards measure different attributes, paper benchmarks are vendor-reported, and most published metrics are computed on test sets that do not match catm's workload (long-form English prose read aloud).

### Subjective leaderboards (human preference)

Two third-party leaderboards aggregate blind A/B votes between TTS models. Both use ELO ratings; direct comparisons are valid *within* a leaderboard but not across them.

**[TTS Arena V2 (HuggingFace)](https://tts-agi-tts-arena-v2.hf.space/leaderboard)** — most active community voting:

| Rank | Model | ELO | Win rate | License |
|---|---|---|---|---|
| 1 | CastleFlow v1.0 | 1574 | 60% | Closed |
| 3 | Inworld TTS MAX | 1571 | 61% | Closed |
| 5 | Hume Octave | 1561 | 64% | Closed |
| 8 | Eleven Turbo v2.5 | 1539 | 57% | Closed |
| **16** | **Kokoro v1.0** | **1500** | **45%** | **Apache 2.0** |
| 25 | CosyVoice 2.0 | 1358 | 28% | Apache 2.0 |

Kokoro v1.0 is the only sub-100M open-weight model in the top 26. It wins 45% of head-to-head matchups — a substantive figure against a leaderboard dominated by closed-source frontier systems. The next open-weight entry (CosyVoice 2.0) trails by 142 ELO points. **No 1-2B open-weight TTS (Qwen3-TTS, Chatterbox-Turbo, Orpheus 1B/3B, Supertonic 3, Higgs Audio) has been ranked yet.** Until they are, quality is inferred from other signals.

**[Artificial Analysis TTS Leaderboard](https://artificialanalysis.ai/text-to-speech/leaderboard)** — heavier emphasis on API-served models:

| Rank | Model | ELO | License |
|---|---|---|---|
| 1 | Realtime TTS 1.5 Max | 1206 | Closed |
| 2 | Gemini 3.1 Flash TTS | 1205 | Closed |
| 3 | StepAudio 2.5 TTS | 1188 | Closed |
| 4 | Eleven v3 | 1180 | Closed |
| — | Fish Audio S2 Pro | 1128 | Open weights (5B) |
| — | Magpie-Multilingual 357M | 1065 | Open |
| — | Voxtral TTS | 1058 | Apache 2.0 (4B) |
| — | **Kokoro 82M v1.0** | **1056** | **Apache 2.0** |

Two conclusions from these leaderboards together:

1. **Open-weight models trail closed frontier models by approximately 75–100 ELO** — non-trivial but not disqualifying. Top closed wins approximately 60% of head-to-heads; Kokoro wins approximately 45%.
2. **Kokoro is the highest-ranked sub-100M model on both leaderboards** that surface this weight class. For Low tier this is direct evidence supporting the PRD's selection.

### Objective benchmarks (intelligibility and speaker similarity)

The two metrics most commonly reported in TTS literature:

- **WER (Word Error Rate)** — synthesise text, transcribe the audio with an ASR model, compare against the input. Lower indicates more accurate pronunciation.
- **SIM (Speaker Similarity)** — cosine similarity between speaker embeddings of generated audio and reference. Higher indicates closer voice cloning.

Both are imperfect proxies for perceived audio quality, but they are the metrics published papers report.

#### Seed-TTS Eval results (test-en, lower is better for WER)

| Model | WER en | SIM | Source |
|---|---|---|---|
| **Qwen3-TTS-12Hz-1.7B-Base** | **1.24%** | **0.789** | Qwen tech report — SOTA in their comparison |
| CosyVoice 3 1.5B (RL) | 1.45% | — | CosyVoice 3 paper |
| CosyVoice 3 0.5B (RL) | 1.68% | — | CosyVoice 3 paper |
| F5-TTS | 2.00% | — | comparison in CosyVoice 3 paper |
| Higgs Audio V2 (5.8B) | 2.44% | 0.677 | Higgs Audio V2 paper |
| VibeVoice | 3.04% | — | comparison in CosyVoice 3 paper |

For a TTS reader, **WER is the primary metric**. It measures whether the audio reproduces the input text — mispronunciations, dropped words, repetitions. A 1.24% WER corresponds to approximately 99% word-level accuracy; a 3% WER corresponds to approximately 3 word errors per 100.

Qwen3-TTS 1.7B has the strongest published WER on test-en across the open-weight field. **If browser deployment is feasible, the objective data supports it as the High-tier selection.**

#### Minimax-MLS Speaker Similarity (English)

| Model | English SIM | Source |
|---|---|---|
| VoxCPM2 (2B) | 85.4% | VoxCPM2 announcement |
| ElevenLabs (proprietary baseline) | 61.3% | VoxCPM2 announcement |
| Supertonic 3 (99M) | "competitive with VoxCPM2" — exact number not published | Supertonic announcement |

VoxCPM2 is out of browser scope (2B parameters at 48 kHz studio output) but provides a useful upper bound for open-weight speaker similarity. Supertonic 3 claims comparable similarity at approximately one-twentieth the size, though the specific value is not published — vendor claim only.

#### EmergentTTS-Eval (model-as-judge, prosodic/expressive challenges)

| Model | Win rate vs gpt-4o-mini-tts | Categories tested |
|---|---|---|
| Higgs Audio V2 | 75.7% | Emotions |
| Higgs Audio V2 | 55.7% | Questions |

This benchmark uses Gemini 2.5 Pro as a judge of audio expressiveness — informative for prosodic and expressive output but methodologically new. Orpheus is listed as a participant in the paper; specific scores were not recovered in this research.

### Gaps in the published numbers

Three known gaps:

1. **Long-form English reading is absent from standard benchmarks.** Seed-TTS test-en uses short utterances. MLS uses approximately 10-second clips. Catm's workload is a 12,000-word chapter. Cross-chunk seam quality and prosody consistency across long-form input are not covered in the published metrics.

2. **Cross-model WER is not normalised by hardware or runtime configuration.** Vendor-reported numbers reflect best-case configurations (full-precision PyTorch, A100 GPUs, optimal sampling parameters). Browser deployment at q4 or INT4 will produce higher error rates on the same content; the delta is an evaluation measurement.

3. **Vendor-reported versus third-party.** Most paper numbers are self-reported. Independent third-party benchmarks (TTS Arena, Artificial Analysis) cover only Kokoro at the relevant weight classes. For Chatterbox-Turbo, the 63.75% blind-preference figure originates in a [Resemble-commissioned Podonos study](https://www.resemble.ai/chatterbox-turbo/) — directionally informative but not third-party objective.

### Impact on tier selection

The objective data adjusts the conclusions:

- **Low tier (Kokoro)** — supported by the only third-party human-preference data available. Strongest evidence base.

- **Medium tier (Chatterbox-Turbo versus CosyVoice 3)** — the data favours CosyVoice 3 on objective metrics (1.68% WER versus no published Chatterbox WER) and favours Chatterbox-Turbo on vendor-published blind preference and on browser-deployment readiness (official ONNX). For long-form reading, **WER plausibly outweighs expressive voice cloning**, which favours CosyVoice 3. The earlier selection of Chatterbox-Turbo was made on browser-deployment ergonomics; the benchmark data reduces the margin.

- **High tier (Qwen3-TTS versus Orpheus 1B)** — the data favours Qwen3-TTS. 1.24% WER on test-en is the strongest published number in the open-weight field. Orpheus 1B has no specific published numbers. **The benchmark evidence shifts the selection toward Qwen3-TTS for High** — and the [`Soundly/Qwen3-TTS-12Hz-1.7B-ONNX-INT4`](https://huggingface.co/Soundly/Qwen3-TTS-12Hz-1.7B-ONNX-INT4) ONNX port (verified in the previous research iteration) becomes the primary evaluation target.

The revised tier ranking, weighted by benchmark evidence rather than deployment ergonomics:

| Tier | Strongest benchmark candidate | Strongest deployment candidate |
|---|---|---|
| Low | Kokoro 82M (also leads on deployment) | Kokoro 82M |
| Medium | CosyVoice 3 0.5B (lower WER) | Chatterbox-Turbo 350M (official ONNX) |
| High | Qwen3-TTS 1.7B (SOTA test-en WER) | Orpheus 1B (Llama-3 quantisation path) |

When the benchmark-leading and deployment-leading candidates diverge, the selection depends on the evaluation: if Qwen3-TTS INT4 and Chatterbox-Turbo at q4f16 load and execute correctly in `onnxruntime-web`, the benchmark winners prevail. Otherwise, the deployment-favoured fallbacks prevail.

### Evaluation recommendations

In addition to the per-tier evaluation measurements logged below, the benchmark gaps motivate the following:

1. **Conduct a listening test on a representative English long-form passage** — identical 1–2 paragraphs through all four candidate models (Kokoro, Chatterbox-Turbo, CosyVoice 3, Qwen3-TTS via Soundly INT4, Orpheus 1B). Score on naturalness, intelligibility, prosody, seam quality.
2. **Measure WER on actual output** — synthesise a reference passage, transcribe with [whisper-large-v3](https://huggingface.co/openai/whisper-large-v3), compute WER against the input. Vendor numbers may be optimistic; first-party measurements are authoritative.
3. **Score speaker consistency across chunks** — synthesise 20 consecutive paragraphs, evaluate voice drift.

A short evaluation cycle substitutes for indeterminate wait time on third-party leaderboards covering the 1–2B class.

## Low tier — Kokoro 82M v1.0 [retain]

**Recommendation: retain the PRD selection.** Kokoro is the only model in this weight class with verified end-to-end browser plus WebGPU execution today, demonstrated in [Xenova's transformers.js example](https://huggingface.co/posts/Xenova/620657830533509). Apache 2.0. 10.4 M downloads.

### Variants on disk

| File | Size |
|---|---|
| `kokoro-v1.0.onnx` (fp32) | 310 MB |
| `kokoro-v1.0.fp16.onnx` | 169 MB |
| `kokoro-v1.0.int8.onnx` | **88 MB** ← distribution artifact |

### Rationale against substituting Supertonic 3 for Low

Supertonic 3 is the most recent entrant in this weight class and warrants side-by-side evaluation. Three reasons to retain Kokoro for v1:

1. **License.** Kokoro is Apache 2.0 (fully permissive). Supertonic 3 is **OpenRAIL-M** — a Responsible-AI license with use-case restrictions (prohibition on harassment, deception, etc.). Probably acceptable for catm but introduces a compliance surface the project does not require.
2. **Browser deployment maturity.** Kokoro has been operational in browsers via transformers.js for approximately 12 months. Supertonic 3 (published April 29, 2026) has browser examples in HuggingFace Spaces but no production-validated transformers.js integration.
3. **No significant quality gap on English long-form.** Supertonic 3's strength is 31-language coverage. For an English-only v1, the multilingual breadth has no value, and Kokoro's English quality is competitive in the published benchmarks.

If Kokoro's seam quality fails PRD Goal #1 in evaluation, **Supertonic 3 is the primary alternative** — same size class, ONNX-native, supports a fixed-voice configuration consistent with this product.

### Evaluation measurements (Low)

- INT8 inference latency on representative paragraphs
- Seam quality across chunk boundaries
- RAM during synthesis (expected approximately 600 MB; verify)
- Real-time factor on target hardware

## Medium tier — Chatterbox-Turbo 350M [revise]

**Recommendation: revise the PRD selection** from CosyVoice 3 0.5B to **Chatterbox-Turbo 350M**.

[`ResembleAI/chatterbox-turbo-ONNX`](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX) is the most production-ready Medium-tier candidate currently available:

- **MIT license.** No use-case restrictions, no attribution beyond the standard notice.
- **Official ONNX release** from Resemble AI rather than a community port. Multiple quantisation variants: `fp32`, `fp16`, `q8`, `q4`, `q4f16`.
- **350 M parameters** — approximately 4× Kokoro's size, appropriate for a Medium tier.
- **Approximately 6× real-time** on a consumer GPU, sub-200 ms time-to-first-audio. (Reference: Kokoro is approximately 1.7× real-time.)
- **Mel-decoder distilled from 10 steps to 1** — fast on browser-tier hardware.
- **Native paralinguistic tags** — `[cough]`, `[laugh]`, `[chuckle]`, etc., embeddable in input text.
- **2.13 M downloads** on the parent `ResembleAI/chatterbox` repository.

### Estimated browser footprint

At q4f16 (smallest quantisation), the four model components together are projected at **150–200 MB on disk** with **approximately 1.5–2 GB RAM** during synthesis. This is within the PRD's Medium-tier budget (approximately 500 MB disk was a pre-evaluation upper bound; q4f16 is closer to 200 MB).

### Caveats

- **Browser inference via `onnxruntime-web` is not explicitly demonstrated** by Resemble. The published examples are Python `onnxruntime`. Integration work required.
- **English-focused** (the multilingual variant Chatterbox-Multilingual is a separate 23-language model).
- **PerTh watermarking** is embedded in output. Inaudible, but should be disclosed in privacy and About copy.

### Rationale against CosyVoice 3 0.5B

- ONNX export exists ([`ayousanz/cosy-voice3-onnx`](https://huggingface.co/ayousanz/cosy-voice3-onnx), [`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512)) but **no demonstrated browser execution**.
- Released December 2025; less ecosystem maturity.
- Larger (0.5 B versus 0.35 B) for plausibly equivalent English quality.
- Strength is multilingual including Mandarin; not a v1 requirement.

CosyVoice 3 remains the secondary candidate if Chatterbox-Turbo does not pass the browser-integration evaluation.

### Evaluation measurements (Medium)

- Verify `onnxruntime-web` loads the q4f16 components
- Disk and RAM at q4f16
- Time-to-first-audio with cold model
- Seam quality (Chatterbox-Turbo's 1-step decoder may concatenate differently from Kokoro)

## High tier — Orpheus 1B [revise]

**Recommendation: revise the PRD selection** from Qwen3-TTS 2B (1.7B) to **Orpheus 1B**.

[`canopyai/Orpheus-TTS`](https://github.com/canopyai/Orpheus-TTS) is distributed as a family — 150 M, 400 M, 1 B, 3 B. Apache 2.0 across all variants. The flagship is the 3B, but **the 1B variant is the appropriate selection for catm's High tier** because it is the largest variant in the family with a realistic browser-deployment path.

### Rationale for Orpheus over Qwen3-TTS

- **Apache 2.0 versus Apache 2.0** — license parity.
- **Multiple sizes in a single architecture** — 150M, 400M, 1B, 3B share the same architecture, permitting tier progression without re-architecting the integration. Variant selected by fit.
- **Llama-3 backbone** — established quantisation behaviour (q4 and q4f16 paths well-validated on Llama derivatives).
- **Voice cloning and emotion control** — not v1 features but supported by the same artifact.
- **Lower latency on smaller variants** — approximately 200 ms streaming.

### Estimated browser footprint (1B variant)

| Quantisation | Approximate disk | Approximate RAM |
|---|---|---|
| fp16 | ~2 GB | ~3 GB |
| q8 | ~1 GB | ~2 GB |
| q4 | **~600 MB** | **~1.5 GB** |

q4 satisfies the PRD's "high-end devices only" constraint. At approximately 600 MB disk it is approximately 8× Kokoro — a substantive Medium-to-High step in tier cost.

### The 3B variant

Orpheus 3B is the closer match to "best — near-human, expressive" in the PRD's Settings UI. Browser deployment of 3B is at the boundary of feasibility (q4 ≈ 1.7 GB; user devices require 4 GB or more free RAM). Worth a verification evaluation but unlikely to ship in v1. The 1B is positioned as High in the UI and the distinction disclosed.

### Rationale against Qwen3-TTS 1.7B (PRD selection)

- 2 B parameters per the HuggingFace model card — larger than the PRD assumed (1.7 B refers to active parameters; the full checkpoint is 2 B).
- At q4, approximately 1 GB disk and approximately 2.5 GB RAM. Beyond browser comfort.
- Less browser-deployment activity than Orpheus.

Qwen3-TTS remains a secondary candidate. If a future user requires Mandarin (Qwen's strength), it is the appropriate model, but that is a v1.x feature.

### Evaluation measurements (High)

- Verify Orpheus 1B q4 loads in `onnxruntime-web` plus WebGPU
- TTFA on a cold model — expected to exceed Low and Medium given the size
- Audible quality delta over Medium — does it justify the resource cost in evaluation listening tests

## Models considered and rejected

- **[Higgs Audio V2](https://github.com/boson-ai/higgs-audio)** — 3.6 B LLM plus 2.2 B audio FFN, approximately 5.8 B total. Exceeds browser budget under any quantisation.
- **[Voxtral 4B](https://huggingface.co/mistralai/Voxtral-4B-TTS-2603)** — 4 B, server-class.
- **[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2)** — 12+ GB VRAM for fp32. Server-class.
- **[XTTS-v2](https://huggingface.co/coqui/XTTS-v2)** — Coqui Public License is non-commercial only. License incompatible with an MIT project.
- **[Fish s2-pro](https://huggingface.co/fishaudio/s2-pro)** — 5 B.
- **[MOSS-TTS-Nano-100M](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M)** — 100 M, recently released, license and browser execution unclear; a candidate Low-tier fallback pending evaluation data.

## PRD changes implied

The PRD §"Tiered voice — a user-facing choice" table currently lists:

```
Low: Kokoro 82M, ~80 MB
Medium: CosyVoice3 0.5B, ~500 MB
High: Qwen3-TTS 0.6B, ~700 MB
```

Following this research, the revised user-facing copy is:

```
Low: Kokoro 82M, ~80 MB, Apache 2.0, English
Medium: Chatterbox-Turbo 350M, ~200 MB, MIT, English
High: Orpheus 1B, ~600 MB, Apache 2.0, English
```

All three permissive, all three browser-deployable subject to evaluation verification, and the size gradient is sufficient to constitute a meaningful tier selection. Quality descriptors in the UI ("Good, pleasant" / "Closer to human" / "Best, expressive") are unchanged.

---

## Stack alignment summary (both parts)

| Component | Model | Runtime | Format | Acceleration |
|---|---|---|---|---|
| **Sentence + paragraph segmenter** | `sat-3l-sm` | ONNX Runtime Web | ONNX (INT8) | WebGPU → WASM |
| **TTS — Low** | Kokoro 82M v1.0 | ONNX Runtime Web | ONNX (INT8) | WebGPU → WASM |
| **TTS — Medium** | Chatterbox-Turbo 350M | ONNX Runtime Web | ONNX (q4f16) | WebGPU → WASM |
| **TTS — High** | Orpheus 1B | ONNX Runtime Web | ONNX (q4) | WebGPU → WASM |
| **Audio encoder** | WebCodecs `AudioEncoder` | Native browser | fragmented MP4 | Native |
| **Playback** | hls.js + `<audio>` | Native browser | HLS + fMP4 | Native MSE |

One ML runtime end-to-end. One acceleration backend. One TTS model architecture family (Llama-based) beyond the Low tier.

## Aggregate open questions for evaluation

1. SaT — ONNX file size at INT8, cold-load latency, RAM, paragraph quality, Viterbi versus greedy.
2. Kokoro — INT8 latency, seam quality, RAM, real-time factor.
3. Chatterbox-Turbo — `onnxruntime-web` viability at q4f16, disk, RAM, TTFA, seam quality.
4. Orpheus 1B — q4 loadable in `onnxruntime-web`? TTFA? Quality delta over Medium relative to the resource cost?
5. Cross-tier — does the chunking strategy applied to Kokoro generalise to the larger models? (Expected yes; verify by measurement.)

---

## References

### Chunker

- [`segment-any-text/wtpsplit`](https://github.com/segment-any-text/wtpsplit) — the SaT toolkit
- [`segment-any-text/wtpsplit` releases](https://github.com/segment-any-text/wtpsplit/releases) — 2.2.0 added length-constrained segmentation
- [Segment Any Text paper (EMNLP 2024)](https://aclanthology.org/2024.emnlp-main.665/)
- [`segment-any-text/sat-3l-sm`](https://huggingface.co/segment-any-text/sat-3l-sm)
- [`ModelCloud/sat-3l-sm-int8-onnx`](https://huggingface.co/ModelCloud/sat-3l-sm-int8-onnx)
- [`superlinear-ai/wtpsplit-lite`](https://github.com/superlinear-ai/wtpsplit-lite)
- [Transformers.js v3 / v4 release notes](https://huggingface.co/blog/transformersjs-v3)
- [`alea-institute/charboundary-small-onnx`](https://huggingface.co/alea-institute/charboundary-small-onnx)

### TTS

- [`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M) — canonical PyTorch weights
- [`onnx-community/Kokoro-82M-v1.0-ONNX`](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) — distribution ONNX export
- [Xenova on Kokoro v1.0 in the browser](https://huggingface.co/posts/Xenova/620657830533509)
- [`ResembleAI/chatterbox-turbo-ONNX`](https://huggingface.co/ResembleAI/chatterbox-turbo-ONNX) — Medium-tier selection
- [`ResembleAI/chatterbox`](https://huggingface.co/ResembleAI/chatterbox) — parent repository
- [`canopyai/Orpheus-TTS`](https://github.com/canopyai/Orpheus-TTS) — High-tier selection (1B variant)
- [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3) — Low-tier alternative
- [`FunAudioLLM/Fun-CosyVoice3-0.5B-2512`](https://huggingface.co/FunAudioLLM/Fun-CosyVoice3-0.5B-2512) — Medium-tier fallback
- [`Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice`](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) — High-tier fallback (Mandarin support)
- [`OpenMOSS-Team/MOSS-TTS-Nano-100M`](https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M) — small-tier monitoring candidate
- [Higgs Audio V2 (Boson AI)](https://github.com/boson-ai/higgs-audio) — server-class
- [HF text-to-speech trending list](https://huggingface.co/models?pipeline_tag=text-to-speech&sort=trending)
- [State of Open Source on HF, Spring 2026](https://huggingface.co/blog/huggingface/state-of-os-hf-spring-2026)

### Benchmarks

- [TTS Arena V2 (HuggingFace) leaderboard](https://tts-agi-tts-arena-v2.hf.space/leaderboard) — blind A/B preference ELO
- [Artificial Analysis TTS Leaderboard](https://artificialanalysis.ai/text-to-speech/leaderboard) — API-served model rankings
- [Qwen3-TTS Technical Report](https://arxiv.org/html/2601.15621v1) — Seed-TTS WER results
- [CosyVoice 3 paper (arXiv 2505.17589)](https://arxiv.org/pdf/2505.17589) — test-en WER, baseline comparisons
- [Higgs Audio V2 model card](https://huggingface.co/bosonai/higgs-audio-v2-generation-3B-base) — SeedTTS-Eval, EmergentTTS-Eval
- [EmergentTTS-Eval (arXiv 2505.23009)](https://arxiv.org/html/2505.23009v1) — model-as-judge prosodic/expressive evaluation
- [TTSDS2 benchmark (arXiv 2506.19441)](https://arxiv.org/html/2506.19441) — human-quality TTS evaluation framework
- [VoxCPM2 announcement (Medium)](https://medium.com/@tentenco/voxcpm2-the-open-source-voice-model-that-beats-elevenlabs-on-similarity-but-the-full-benchmark-ffe408b50b87) — Minimax-MLS SIM numbers
- [Chatterbox-Turbo blind-preference study (Resemble)](https://www.resemble.ai/chatterbox-turbo/) — vendor-published, 63.75% vs ElevenLabs Turbo
- [openai/whisper-large-v3](https://huggingface.co/openai/whisper-large-v3) — ASR reference for our own WER measurement
