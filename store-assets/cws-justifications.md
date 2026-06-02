# Chrome Web Store — dashboard justification strings

Paste into the "Privacy practices" tab of the developer dashboard. Each declared permission is
compared against actual usage; keep each tied to a concrete feature.

## Single purpose

> catm converts text from a web page — either the text you select or the page's main article — into spoken audio, entirely on your device, in a side panel.

## Store listing copy

| Field | Limit | Value |
|-------|-------|-------|
| Name | 75 | catm |
| Summary | 132 | On-device long-form text-to-speech in a side panel. Right-click → Read selection or Read page. |
| Category | — | Accessibility |
| Description | 16,000 | catm reads text aloud using an on-device neural voice (Kokoro 82M), running entirely in your browser — no servers, no accounts, no tracking. On any page, right-click and choose **Read selection** to narrate the text you highlighted, or **Read page** to pull out the main article and read it. The side panel narrates with WebGPU-accelerated synthesis, progressive playback, and a saved library of past readings. The speech model downloads once from Hugging Face on first use; after that catm works fully offline. |

## Permission justifications

**contextMenus**
> Adds the right-click "catm" submenu with "Read selection" and "Read page" entries so the user can send text to the side panel for narration.

**sidePanel**
> Opens the extension's interface in the browser side panel, where the text-to-speech app runs.

**storage**
> Uses `chrome.storage.session` to hand the text from the right-click menu to the side panel; the browser clears it when the window closes. No data is sent anywhere. (Saved readings and audio live in the extension's own IndexedDB/OPFS, which need no permission.)

**activeTab**
> "Read page" reads the main article from the page the user right-clicked on. The context-menu click grants temporary access to just that one tab, so catm can extract its text without any broad host permission. Nothing runs until the user invokes the menu item.

**scripting**
> "Read page" uses `chrome.scripting.executeScript` to inject a one-shot extractor into the clicked tab (under the activeTab grant above). The extractor runs Mozilla Readability locally to pull out the article text, posts it back to the extension, and does nothing else. No script runs on any page until the user chooses "Read page".

## Host permission justification

> None. catm declares no `host_permissions` and registers no persistent content scripts. "Read selection" only sees text the user explicitly highlights and sends via the menu. "Read page" injects its extractor on demand under the `activeTab` grant a context-menu click provides — limited to that single tab, for that single invocation. The one-time speech-model download from `huggingface.co` uses that host's CORS headers and requires no host permission.

## Data usage

Three disclosures for the certification checkboxes:

- **Collected or used:** No. catm does not collect or use personal data. Selected text and extracted page articles are narrated locally and only the readings the user chooses to save are kept on-device.
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
| Website content | Yes | The text the user selects, or the main article extracted from the page when the user chooses "Read page", is read aloud and synthesised to audio entirely on-device; it is never transmitted. |

## Remote code

> catm executes no remote code. All JavaScript and the ONNX Runtime WASM are bundled in the package. On first use it downloads the Kokoro TTS model **weights** (~310 MB of data, not code) from `huggingface.co` into local Cache Storage; thereafter it runs fully offline.

## Privacy policy URL

> https://github.com/alainbrown/catm/blob/main/PRIVACY.md
