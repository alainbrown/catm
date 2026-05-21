# PRD — catm web app + browser extension

## Summary

A text-to-speech reader for the web distributed as two surfaces of a single product:

1. **A Progressive Web App at `catm.app`** — visit the URL, paste or type text, invoke Read, listen. No installation required. Operates in any modern browser. After a single online visit, operates fully offline.
2. **A browser extension** for Chrome and Chrome-compatible browsers (Edge, Brave, Arc) that embeds catm in the active page. Right-click any selected text → "Read with catm." Playback occurs in a side panel. Installed once via the Chrome Web Store.

Both surfaces are the same product — same UI, same voice, same library of past reads. The extension provides integration in the context where most reading occurs: inside another tab.

The MVP validates one question: is the product useful enough to drive daily return usage?

## Goals

1. **Natural-sounding output.** A user listens to a 10-minute-or-longer article without abandonment caused by voice quality.
2. **Low time-to-first-audio.** Audio begins within approximately 3 seconds of invoking Read; remaining audio is synthesised in the background.
3. **Long-form support.** A 12,000-word chapter plays with equivalent fidelity to a 500-word news article. Seek, pause, resume.
4. **Two access surfaces.** The PWA at `catm.app` is the universal entry point — any browser, any operating system, no installation. The extension provides in-page integration.
5. **Full offline operation.** No network requests at runtime. The first online visit caches all required resources.

## Non-goals for this version

- A native macOS, Windows, or Linux desktop application — predecessors exist and are being deprecated in favour of the browser-distributed version
- A native mobile application — the PWA serves the mobile use case; native iOS and Android are future-version considerations
- A general-purpose accessibility reader (screen-reader replacement use cases are out of scope)
- A creator tool (no voice cloning, no audio export, no recording)
- A configurable platform with multiple voices in v1 — single tier
- A user-account or cloud-sync product
- Firefox and Safari support in v1 — catm targets Chrome and Chrome-compatible browsers (Edge, Brave, Arc). Other browsers deferred subject to demand.

---

## Voice quality requirements

The voice is the product. The acceptance threshold is "a user listens for 10 or more continuous minutes without abandonment caused by voice quality."

Required behaviour:
- Sustain attention across long-form content
- Natural sentence intonation, correct handling of punctuation
- Pronounce common English correctly, including proper nouns, abbreviations, numerals, dates
- Maintain consistent speaker identity across long reads
- No clicks, clipping, or distortion

### Tiered voice — a user-facing choice

The user selects Low, Medium, or High in Settings. The tier name discloses the resource trade-off: a higher tier produces higher voice quality at the cost of a larger one-time download, increased memory consumption during reading, and lower synthesis throughput. Settings displays the full trade-off adjacent to each option to enable informed selection.

| Tier | Voice quality | One-time download | RAM while reading | Preparation speed | Hardware needed |
|---|---|---|---|---|---|
| Low | Good — clearly synthetic but pleasant; suitable for long listens | ~80 MB | ~600 MB | Prepares faster than playback. Forward seek is instant. | Runs on most laptops |
| Medium | Better — closer to a human narrator | ~200 MB | ~1.5–2 GB | Prepares slightly slower than playback. Long forward seeks may briefly pause. | Needs a modern device |
| High | Best — near-human, expressive | ~600 MB | ~1.5 GB | Prepares slower than playback. Expect short pauses on forward seek. | High-end devices only |

**v1 ships Low as the only installable tier.** Medium and High are visible in Settings as "Coming soon" so the tier system is communicated from the first release. The single-tier launch is a product risk — see Success Criteria.

(This document does not name specific models — those determinations are in the technical specification and may change without affecting the user-facing tier definitions. The values above are budgets the selected model must satisfy.)

---

## User-facing budgets

| Budget | Target |
|---|---|
| **Time from URL to first audio (first visit)** | Under 90 seconds — includes one-time voice download |
| **Time from URL to first audio (returning visit, offline)** | Under 5 seconds — app starts immediately, audio starts within 3 |
| **First-audio latency once voice is loaded** | Under 3 seconds — time from pressing Read to hearing the first words |
| **Voice download (one time, first online visit)** | ~80 MB for the Low tier |
| **Total storage after a week of use** | Under 500 MB (voice + a handful of past sessions) |
| **Battery impact during playback** | Comparable to a media player |

---

## How the two surfaces interoperate

`catm.app` is the primary surface of the product. The extension provides in-page integration.

After a single online visit to `catm.app` — by direct URL or via extension installation — all required resources are cached. Past sessions, the voice, and settings persist on the device at that origin. The extension's side panel is a view onto the same product. Opening `catm.app` in a new tab presents the same library, voice, and draft text. The two surfaces are not separate products synchronised across a network; they are a single product accessed via two entry points sharing one origin.

User-visible consequences:

- A session started in the PWA appears in the extension's Library, and vice versa.
- Voice and settings are shared.
- Past sessions persist on the device, in this browser, in this profile. They do not propagate to other devices in v1.

Extension-only capabilities:

- Right-click any selected text on a webpage and play it immediately.
- Continue audio playback after the side panel or source tab is closed.
- Open from the toolbar icon in a single action.

PWA-only capabilities:

- Open by link or bookmark — no installation, no permissions prompt.
- Install to the dock or home screen as an application on desktop and mobile.

---

## Chunked progressive synthesis

The defining feature for long-form input. A 12,000-word chapter is the canonical test case.

### User-observable behaviour

1. **Audio playback begins as soon as the first segment is synthesised.** Invoke Read, audio begins within approximately 3 seconds.
2. **Remaining audio is synthesised progressively** in the background during playback.
3. **Pause, resume, and seek at any time.** Backward seek resolves immediately. Forward seek into a synthesised region resolves immediately. Forward seek into an unsynthesised region blocks briefly until synthesis catches up.
4. **Backward seek is always immediate.** Already-synthesised audio is buffered locally.
5. **Forward seek into the unsynthesised region** displays a brief loading state. The scrub bar visually distinguishes three regions: played, synthesised, unsynthesised.
6. **No input length cap.** Text streams in, audio streams out. A 200,000-word novel operates identically to a 500-word article. Only the active audio window resides in memory; synthesised segments are persisted to disk as they complete.
7. **The session ends on user stop, navigation away from `catm.app`, or initiation of a new read.** In the extension, audio survives side panel closure — see Journey 2. Past sessions are listed under Library.

---

## Detailed user journeys

Three journeys. Each is a connected sequence rather than a single interaction, representing actual usage patterns.

### Journey 1 — Sarah finds catm

Sarah hears about catm from a friend who sends her a link: `https://catm.app`.

She clicks. The page loads in under a second. There's a single multi-line text area with the placeholder "Paste or type text to read." Above it, the catm wordmark and a small notice: *"First time? Download the voice (~80 MB) to start reading. Everything stays on your device."* Below the editor, a Read button — disabled — and a Library / Settings tab strip at the bottom.

She clicks Download voice. A progress bar appears; the rest of the UI dims slightly. Forty-five seconds later, the notice is gone, Read is enabled, and the voice line in the header now reads *"Voice · Low tier."* Sarah pastes the article her friend sent — about 2,000 words. She presses Read.

Within three seconds, audio starts. The editor smoothly transitions into the playing view: title auto-generated from the first sentence, estimated length, scrub bar with three subtle regions, transport controls (−30s, play/pause, +30s, Stop) and a speed selector. Sarah listens for a few minutes, then drags the scrub bar back by half a minute to catch a sentence she missed. The jump is instant.

She closes the tab without thinking about it.

A week later, she's on a plane with no Wi-Fi. She opens her browser and types `catm.app`. The app loads — offline — in under a second. Her last article is in Library, still scrubbable from where she left off. She doesn't have anything new to read; the bookmark itself is the trigger. She pastes a longer essay copied earlier, presses Read, and listens for the rest of the descent.

She didn't install anything. She didn't sign up. She didn't see a permissions prompt. The next time she's at her desktop she'll click her browser's "Install catm" affordance and pin it to her dock — but she didn't have to.

### Journey 2 — Jordan listens to a chapter on the move

Jordan installs the extension from the Chrome Web Store. The browser asks for the standard permissions; Jordan accepts. A welcome tab opens, the voice downloads in the background while a short page explains how to use catm: *"Select text on any page, right-click → Read with catm. Or click the toolbar icon to paste text directly."* When the voice is ready, the page says so and invites Jordan to close the tab.

Two days later, Jordan is reading a long essay in their browser — about 12,000 words, roughly a book chapter. They want to listen on a walk. They select the entire piece (Cmd-A, then Cmd-C habit, but a select-all works just as well), right-click, choose "Read with catm."

The side panel opens with the selected text already in the editor and a title auto-generated from the first sentence. Within three seconds, audio begins through Jordan's AirPods. The side panel shows: title, estimated total length, the three-region scrub bar, the transport, and the speed selector (1.25× by default — Jordan changed this on day one).

Jordan closes the side panel and closes the source tab. Audio keeps playing. They put on a coat and leave.

Five minutes into the walk, Jordan misses a sentence. They take out their laptop briefly, click the catm toolbar icon, and the side panel re-opens — current position visible on the scrub bar, audio still playing uninterrupted. They tap −30s twice; audio jumps back instantly and continues.

Twenty minutes in, Jordan wants to skip a long footnote. They drag the scrub bar forward, past the lightly-shaded "prepared" region into the un-shaded "unprepared" region. Audio pauses for about three seconds while preparation catches up; a small "preparing…" indicator appears under the scrub bar. Then audio resumes from the new position.

Jordan closes the laptop again. Some minutes later, a colleague messages on Slack — Jordan opens the laptop to reply and gets pulled into a twenty-minute conversation. They forget about the chapter. The toolbar icon shows a faint "playing" dot the whole time.

Eventually the chapter finishes. The toolbar icon goes idle. The session is preserved under Library — Jordan can return to any sentence later.

(Caveat we share with the user: under heavy memory pressure or when the browser is fully quit, background audio can stop. We make our best effort; multi-hour unattended playback isn't a promise.)

### Journey 3 — Maya's week with catm

By the second week, Maya has settled into a pattern. catm is open in a pinned tab and also installed as the extension. She uses both without thinking about which.

**Monday morning.** Maya is catching up on a backlog. She opens a long blog post, selects the body, right-clicks → Read with catm. Audio starts. Halfway through, she finds a more interesting article in another tab and wants to switch. She selects the new article's text, right-clicks → Read with catm again. The first session ends mid-sentence; the new one begins immediately. *Read* always means *play this now* — never *queue*. The interrupted Monday-morning session is preserved under Library, still scrubbable from the cut.

**Tuesday.** Maya pastes a Chinese-language passage from a news site, just to see. catm recognises that the voice can't read it: a small notice appears in the editor — *"Nothing to read aloud here — the current voice speaks English only."* No audio. Maya goes back to her English source and continues.

**Wednesday.** Maya wants to revisit an essay she listened to last week. She opens the Library tab. Recent sessions are listed newest first: title (auto-generated from the first sentence, editable), date, duration, a small dot if the session was never finished. She taps the one she wants. The editor reappears with the original text restored and the playhead at the position she stopped. She presses Read and continues.

**Thursday.** Maya is on the train, signal patchy. She opens catm — it loads instantly because everything is local. She pastes a downloaded long-read and listens. The train goes through a tunnel. Nothing about catm flickers; the network was never part of the loop.

**Friday.** Maya's storage indicator (visible in Settings under "Storage usage") shows 312 MB used — mostly the voice plus a few weeks of sessions. She deletes three old sessions she doesn't want to revisit; the indicator drops by 40 MB. She notices Medium and High tiers in Settings, marked *Coming soon*, and makes a mental note to check back. Then she pastes the article she was actually trying to read, presses Read, and gets on with her week.

---

## Functional requirements

### Entry points

**PWA (`catm.app`):**
- Visit the URL directly. Editor and Read control visible.
- "Install" via the browser's PWA installation affordance (desktop, mobile).

**Extension:**
- Right-click selected text on any web page → "Read with catm" → side panel opens with the selection pre-loaded and audio playback initiated immediately.
- Click the toolbar icon → side panel opens (idle, with the last draft restored).
- User-configurable keyboard shortcut "Read selected text" — invokes synthesis without opening the side panel.

### UI (shared between PWA and extension)

**Idle state:**
- Header displaying application name and current tier (e.g. *"catm · Low"*)
- Multi-line text editor with placeholder
- Paste, Clear, and Read controls — Read is the primary action; disabled when no voice is loaded or no text is present
- Speed selector (default 1.25×, options 0.75× to 2×)
- Tabs at the bottom: Library, Settings

**Playing state:**
- Title (auto-generated from the first sentence; user-editable)
- Approximate length, word count
- Scrub bar with three distinct regions: played, synthesised, unsynthesised
- Current position, estimated total
- Transport controls: −30s, play/pause, +30s, Stop
- Speed selector

**Library tab:**

Top of the tab:
- Search field — filters by title and excerpt of the text body
- Count and total storage line, e.g. *"142 sessions · 287 MB"*

Per row:
- Title (auto-generated from the first sentence; user-editable)
- Relative date (*today*, *yesterday*, *3d ago*; absolute date beyond one month)
- Duration
- For unfinished sessions: an indicator dot and estimated remaining time (e.g. *"23 min left"*)
- A short first-line excerpt of the text in a smaller, dim font

List behaviour:
- Reverse chronological order
- Incremental rendering in batches; no pagination
- Activation opens the session. Default behaviour depends on state:
  - **Unfinished session** → resume from the saved position
  - **Finished session** → restart from the beginning

Row actions (long-press or right-click):
- Open
- Resume from saved position / Restart from beginning (whichever is not the default activation behaviour)
- Rename
- Copy text
- Delete

Bulk operations:
- A select-mode toggle in the Library header reveals per-row checkboxes and a "Delete selected" action.
- Settings includes a single-action "Delete all finished sessions older than 30 days."

Empty state:
- *"Nothing here yet. Paste some text and press Read — it'll show up here when it's done."*

**Settings tab:**
- **Voice tier** — Low, Medium, or High selector. Each option displays the user-facing trade-off from §"Tiered voice": a quality descriptor, the one-time download size, the RAM consumption during reading, a description of synthesis throughput, and a hardware-requirement indication. Locked tiers display "Coming soon" in v1.
- Voice management (per-tier download status, deletion)
- Storage utilisation display and clear-all action
- About: license, source, version

### Playback rules

- **Read invokes immediate playback, not enqueueing.** Initiating a new read interrupts the current one. The interrupted session is preserved in Library at the truncation point. Queueing is explicitly not a feature.
- **Reopening a session from Library** follows the default rule above: unfinished sessions resume, finished sessions restart. Both options are always available via the row's context menu.

### Long-content behaviour

- Audio playback begins as soon as the first segment is synthesised.
- Remaining segments are synthesised in the background and persisted to disk as each completes.
- Sessions persist after completion; reopen or delete from Library.
- The scrub bar visually distinguishes played, synthesised, and unsynthesised regions.
- Forward seek into the unsynthesised region triggers a brief "preparing…" wait.
- Backward seek into the played region resolves immediately.

### First-launch onboarding

- **PWA**: the first visit displays a welcome notice above the editor — "Download the voice (~80 MB) to start reading. The voice, your text, and the audio catm generates all stay on your device." Read is disabled until the voice is loaded.
- **Extension**: installing the extension opens a one-time welcome tab. The tab downloads the voice in the background and describes the product. When the voice is loaded, the tab can be closed. The extension operates fully offline from that point.

---

## Mocks

Illustrative; final visual design will vary.

- **Idle state — PWA and extension side panel.** Identical UI in both contexts. Header with application name and voice tier. Multi-line text editor. Paste, Clear, Read controls. Speed selector. Library and Settings tabs.
- **Playing state.** Title at top. Scrub bar with three distinct regions. ±30s controls adjacent to a central play/pause. Speed selector and Stop.
- **Read-along view.** Article text scrolls on screen with per-word highlighting synchronised to playback. Previously-spoken words dim; upcoming words attenuated.
- **Welcome / first-run.** A single voice-download control with a progress bar and a one-line privacy notice.
- **Right-click context menu.** Single "Read with catm" entry, displayed only when text is selected on a page.

---

## Privacy and local data

- **No runtime network requests.** After the first online visit (PWA) or the install-time welcome tab (extension), catm issues no network requests for inference, storage, or telemetry. Operates without network connectivity from that point.
- **No telemetry, analytics, or crash reporting in v1.**
- **No ambient access to web-page content.** The extension accesses only text the user explicitly selects and submits, or text pasted into the side panel.
- **Text and audio are persisted locally.** Past sessions, the voice artifact, and settings reside in this browser, on this profile. No cloud synchronisation, no upload.
- **Privacy statement displayed to users:** *"Everything catm reads — your text and the audio it generates — stays in your browser. Nothing leaves your device."*

---

## Reliability requirements

- catm must not crash on malformed input: unusual characters, high-emoji-density text, mixed-language input, punctuation runs, single sentences exceeding typical length without natural breakpoints.
- If synthesis fails on a specific segment of the text, the session continues by skipping that segment rather than terminating.
- If the device cannot execute the voice at real-time throughput, catm degrades to a slower synthesis mode with a one-time notice. Audio playback continues at lower throughput.
- If background audio in the extension is interrupted by the browser (memory pressure, browser termination), the session ends cleanly and the saved position is restored on next open.
- A user must be able to listen to a 45-minute chapter from start to finish in a single browser session without crashes or quality degradation.
- **Storage pressure is communicated, never silent.** When local storage is within approximately 50 MB of the browser's per-site quota, catm displays a one-time banner in the editor — *"Storage is filling up — delete a few old sessions in Library."* The same message is surfaced in Settings. catm never auto-evicts a session; the user controls all deletion.

---

## Distribution and licensing

- **PWA** at `catm.app`, deployed to a CDN-fronted static host. Continuous deployment. No store review process.
- **Chrome Web Store** for the extension — covers Chrome, Edge, Brave, Arc, and other Chromium-based browsers.
- Released under the MIT license from the initial commit.
- Repository public on GitHub with README, build instructions, contribution guidelines.

---

## Success criteria

The MVP is successful if all of the following are satisfied:

1. **A new user can visit `catm.app` and hear first audio within 90 seconds** of clicking the link, on a typical home network.
2. **A user with the extension installed can right-click and invoke Read on any web page and hear audio within 5 seconds** (warm).
3. **A user can listen to a complete book chapter** (approximately 40 minutes) in a single browser session without crashes, audio artifacts, or quality degradation.
4. **No beta user cites voice quality as the reason for ceasing use of catm.** Validated via direct conversation with beta users in a public channel (Discord or a feedback form linked from Settings) — the only sanctioned feedback channel given the absence of telemetry. A meaningful risk for v1 given the single-tier launch.
5. **Repeat usage within the first week** of initial use — the user returns unprompted.

---

## Stretch goals

- Persisted playback speed across browser sessions
- "Read again from start" action in the playing-state panel
- "Copy current sentence" action that places the highlighted sentence on the clipboard
- Audio or visual cue when synthesis completes for a long read
- Light and dark theme toggle in Settings (auto-following browser default)
- Read-along view as a first-class mode (per-word highlighting)

---

## Future versions (roadmap)

- **Medium tier** — verify, then release.
- **High tier** — verify, then release.
- **Per-voice download UI** when more than one voice is available within a tier.
- **Multi-language voices** — beyond English.
- **"Read this page" content-script mode** — extract the article body and synthesise it, omitting navigation and advertising.
- **PDF reader integration** — synthesise selectable text from in-browser PDFs.
- **Optional opt-in synchronisation** across the user's own devices (via a folder of their selection).
- **Mobile-native application** — only if the PWA on mobile is insufficient for a non-trivial share of users.

---

## Open questions (product / UX)

- **Domain.** `catm.app` or alternative. Ownership and branding decision.
- **Which English voice ships first.** The selected Low-tier model bundles multiple voices; the default is selected by evaluation on representative content for 10 or more continuous minutes. Specific candidates are in the technical specification.
- **Welcome-tab behaviour on user closure mid-download.** Resume on next launch versus restart from initial state — both are defensible; select one.
- **Update UX.** When a new version is available, display a "new version available" notice on next launch or update silently in the background.
- **Beta feedback channel.** Discord, an in-Settings feedback form, or both. Required for Success Criterion #4.
- **Icon design.** Toolbar icon and home-screen / install icon.

(A separate technical specification covers architecture, manifests, browser-runtime selections, storage layout, model loading, and the evaluation programme for Medium and High tiers.)
