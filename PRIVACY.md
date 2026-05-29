# Privacy Policy

_Last updated: 2026-05-29_

catm is a Chrome extension that converts text to speech entirely on your device. It has no backend, no accounts, and no telemetry. Your text and the audio it produces never leave your browser.

## Summary

- **No servers.** All speech synthesis runs locally inside the extension.
- **No accounts.** There is nothing to sign up for.
- **No tracking.** No analytics, error reporting, third-party scripts, or trackers.
- **One network request, ever.** On first use the extension downloads the speech model; after that it works fully offline.

## How it works

The app runs in Chrome's side panel. The first time you open it:

- The Kokoro 82M text-to-speech model (~310 MB) is downloaded once from `huggingface.co` and stored in the browser's Cache Storage. Every later session loads the model from that cache and needs no network access.
- Synthesis runs in the extension via ONNX Runtime Web — WebGPU when available, single-threaded WASM otherwise. The WASM runtime is bundled with the extension; nothing is fetched remotely at synthesis time.

## What is stored, and where

Everything catm stores lives on your device, in your browser's per-extension storage:

- **Saved readings** — session titles, the source text, and playback metadata are kept in IndexedDB.
- **Generated audio** — stored as fragments in the Origin Private File System (OPFS).
- **Preferences** — your onboarding state, selected voice, and playback speed are kept in `localStorage`.

None of this is transmitted anywhere, and none of it syncs between devices.

## The network requests catm makes

- **First use only:** downloading the speech model from `huggingface.co`.
- **Nothing else.**

## What the extension can and cannot do

The extension adds a **Read aloud** entry to the right-click menu when you select text, and opens the side panel when you click its toolbar icon. When you choose **Read aloud**, the selected text is handed to the side panel through `chrome.storage.session` — an in-memory area the browser clears when the window closes. The side panel reads that text on open, then deletes it. No network request is involved.

The extension does **not**:

- Read or modify the pages you visit. It has no content scripts and no host permissions, so it can only ever see text you select and explicitly send via the menu.
- Talk to any server. The selection moves from the background service worker to the side panel through local browser storage and never leaves the browser.
- Sync anything. It does not use `chrome.storage.sync`.

## Permissions

The extension requests only what it needs:

- `contextMenus` — to add the **Read aloud** right-click entry.
- `sidePanel` — to open the side panel where the app runs.
- `storage` — to pass selected text from the menu to the side panel via `chrome.storage.session`, which the browser clears when the window closes.

It does not request `tabs`, host permissions, or any access to the content of the pages you browse.

## Deleting your data

- **In the app:** use **Delete everything** in the side panel. It removes your saved readings (IndexedDB), generated audio (OPFS), your preferences, and the cached speech model.
- **From Chrome:** uninstall the extension at `chrome://extensions`. Removing it removes all of its storage, audio, and the cached model with it.

## Children

catm is general-purpose and does not knowingly collect personal information from children — because it does not collect personal information from anyone.

## Changes

Material changes are reflected in the "Last updated" date above and in the project's commit history.

## Contact

Source code, issues, and the history of this policy live at [github.com/alainbrown/catm](https://github.com/alainbrown/catm).
