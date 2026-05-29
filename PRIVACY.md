# Privacy

_Last updated: 2026-05-26_

catm is a Chrome extension that turns text into speech entirely on your device. No accounts, no servers, no telemetry. This document is the formal statement of that.

## Where things run

The runnable app lives inside the Chrome extension and renders in Chrome's side panel.

The first time you open the side panel:

- The Kokoro 82M text-to-speech model is downloaded once from `huggingface.co` and cached locally in the browser's Cache Storage (~310 MB). Subsequent sessions are fully offline.
- Synthesis runs inside the extension via ONNX Runtime Web — WebGPU when available, single-threaded WASM as a fallback. The WASM runtime ships bundled with the extension; nothing is fetched remotely at synth time.
- Text you paste, saved sessions, and the audio they produce live only on your device: session metadata in IndexedDB, audio fragments in the Origin Private File System (OPFS).

The extension has no backend. No request ever leaves your browser carrying your text or your audio.

## Network requests catm makes

- The extension makes exactly one network request, on first use: downloading the Kokoro model from `huggingface.co`. After that, the extension is fully offline.
- Nothing else.

There are no analytics, no error-reporting services, no third-party scripts, and no trackers.

## The catm Chrome extension

The extension does these things:

- Adds a context-menu entry, **Read aloud**, that appears when you right-click on selected text. Clicking it opens catm's side panel and queues the selection for reading. The active tab's title is passed alongside the text so the side panel can label the session.
- Clicking the toolbar icon opens the side panel.

Selection delivery happens entirely inside the browser, via `chrome.storage.session` — an in-memory store that the browser clears when you close the window. The side panel reads the pending selection on mount and then deletes it. No network request is involved.

It does **not**:

- Read pages on its own. There are no content scripts and no host permissions, so the extension cannot read or modify the pages you visit. It only sees text you yourself select and then explicitly send via the menu.
- Communicate with any server. The selection travels from the background service worker to the side panel via local storage; it never leaves the browser.
- Sync anything between devices. The extension does not use `chrome.storage.sync`.

The permissions the extension requests, and why:

- `contextMenus` — to register the **Read aloud** menu entry.
- `sidePanel` — to open the side panel where the app runs.
- `storage` — to pass the selected text from the menu click to the side panel via `chrome.storage.session`, which is cleared automatically when you close the window.
- `tabs` — to read the active tab's title so the side panel can label the session. No tab contents are read.

## How to delete your data

- **Inside the side panel:** use the _Delete everything_ button. It purges IndexedDB sessions, OPFS audio, your onboarding and voice preferences, and the cached Kokoro model.
- **From the browser:** uninstall the extension from `chrome://extensions`. Removing the extension removes its storage, OPFS, and cached model along with it.

## Children

catm is general-purpose. It does not knowingly collect personal information from children — because it does not collect personal information from anyone.

## Changes to this policy

Material changes will be reflected in the "Last updated" date at the top of this document and in the project's commit history. The current and historical versions of this policy are public at the source-code link below.

## Contact

Source code, issues, and the change history for this policy live at [github.com/catm-app/catm-app.github.io](https://github.com/catm-app/catm-app.github.io).
