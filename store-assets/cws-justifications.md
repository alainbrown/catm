# Chrome Web Store — dashboard justification strings

Paste into the "Privacy practices" tab of the developer dashboard. Each declared permission is
compared against actual usage; keep each tied to a concrete feature.

## Single purpose

> catm converts text you select on a web page into spoken audio, entirely on your device, in a side panel.

## Store listing copy

| Field | Limit | Value |
|-------|-------|-------|
| Name | 75 | catm |
| Summary | 132 | On-device long-form text-to-speech in a side panel. Right-click selected text → Read aloud. |
| Category | — | Accessibility |
| Description | 16,000 | catm reads selected text aloud using an on-device neural voice (Kokoro 82M), running entirely in your browser — no servers, no accounts, no tracking. Select text on any page, right-click **Read aloud**, and the side panel narrates it with WebGPU-accelerated synthesis, progressive playback, and a saved library of past readings. The speech model downloads once from Hugging Face on first use; after that catm works fully offline. |

## Permission justifications

**contextMenus**
> Adds the right-click "Read aloud" entry so the user can send the selected text to the side panel for narration.

**sidePanel**
> Opens the extension's interface in the browser side panel, where the text-to-speech app runs.

**storage**
> Uses `chrome.storage.session` to hand the selected text from the right-click menu to the side panel; the browser clears it when the window closes. No data is sent anywhere. (Saved readings and audio live in the extension's own IndexedDB/OPFS, which need no permission.)

## Host permission justification

> None. catm declares no `host_permissions` and has no content scripts — it can only ever see text the user explicitly selects and sends via the menu. The one-time speech-model download from `huggingface.co` uses that host's CORS headers and requires no host permission.

## Data usage

Three disclosures for the certification checkboxes:

- **Collected or used:** No. catm does not collect or use personal data. Selected text is narrated locally and only the readings the user chooses to save are kept on-device.
- **Sold or transferred to third parties:** No.
- **Used for purposes unrelated to the single purpose** (including creditworthiness or lending): No.

### Data types

Check a row only if the extension actually handles that category. catm is local-only:

| Data type | Handled? | If yes: what + why |
|-----------|----------|--------------------|
| Personally identifiable info | No | — |
| Health information | No | — |
| Financial / payment info | No | — |
| Authentication info | No | — |
| Personal communications | No | — |
| Location | No | — |
| Web history | No | — |
| User activity | No | — |
| Website content | Yes | The text the user selects is read aloud and synthesised to audio entirely on-device; it is never transmitted. |

## Remote code

> catm executes no remote code. All JavaScript and the ONNX Runtime WASM are bundled in the package. On first use it downloads the Kokoro TTS model **weights** (~310 MB of data, not code) from `huggingface.co` into local Cache Storage; thereafter it runs fully offline.

## Privacy policy URL

> https://alainbrown.com/catm/privacy.html (source: `PRIVACY.md` in the repo).
