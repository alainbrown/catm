import type { PageTextPayload } from "../content/extract";
import extractScript from "../content/extract?script";

const ROOT_MENU_ID = "catm-root";
const SELECTION_MENU_ID = "catm-read-selection";
const PAGE_MENU_ID = "catm-read-page";
const PENDING_KEY = "catm:pending-share";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: ROOT_MENU_ID,
    title: "catm",
    contexts: ["page", "selection"],
  });
  chrome.contextMenus.create({
    id: SELECTION_MENU_ID,
    parentId: ROOT_MENU_ID,
    title: "Read selection",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: PAGE_MENU_ID,
    parentId: ROOT_MENU_ID,
    title: "Read page",
    contexts: ["page", "selection"],
  });
});

// Icon click opens the side panel (instead of firing chrome.action.onClicked).
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[catm] setPanelBehavior:", err));

// `play` controls whether the side panel auto-synths on ingest: true for
// "Read selection" (read-aloud semantics), false for "Read page" (stage the
// extracted article in the editor so it can be trimmed before reading).
function stageText(text: string, play: boolean) {
  chrome.storage.session
    .set({ [PENDING_KEY]: { text, play, ts: Date.now() } })
    .catch((err) => console.error("[catm] storage.session.set:", err));
}

// Extracted so e2e can drive the ingest end-to-end: there is no public API
// to fire `chrome.contextMenus.onClicked` programmatically, so tests invoke
// this via `serviceWorker.evaluate(...)`.
function ingestSelection({ text, windowId }: { text?: string; windowId?: number }) {
  const trimmed = text?.trim();
  if (!trimmed) return;
  // chrome.sidePanel.open() needs a synchronous user gesture — any await
  // before calling it consumes the gesture and the panel stays closed.
  // Open first, persist after.
  if (windowId != null) {
    chrome.sidePanel
      .open({ windowId })
      .catch((err) => console.error("[catm] sidePanel.open:", err));
  }
  stageText(trimmed, true);
}
(
  globalThis as typeof globalThis & {
    __catmIngestSelection?: typeof ingestSelection;
  }
).__catmIngestSelection = ingestSelection;

// Inject the Readability extractor into the clicked tab and resolve the text it
// messages back. A context-menu click grants activeTab for that tab — exactly
// what scripting.executeScript needs, with no broad host permission. Resolves
// null on injection failure (restricted pages) or if nothing arrives in time.
function runExtractor(tabId: number): Promise<PageTextPayload | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PageTextPayload | null) => {
      if (settled) return;
      settled = true;
      chrome.runtime.onMessage.removeListener(listener);
      resolve(value);
    };
    const listener = (msg: unknown, sender: chrome.runtime.MessageSender) => {
      const m = msg as { type?: string; payload?: PageTextPayload };
      if (m?.type === "catm-page-text" && sender.tab?.id === tabId) finish(m.payload ?? null);
    };
    chrome.runtime.onMessage.addListener(listener);
    chrome.scripting
      .executeScript({ target: { tabId }, files: [extractScript] })
      .catch(() => finish(null));
    setTimeout(() => finish(null), 10_000);
  });
}

function readPage({ tabId, windowId }: { tabId?: number; windowId?: number }) {
  if (tabId == null) return;
  // Open within the click's user gesture, before any await (see ingestSelection).
  if (windowId != null) {
    chrome.sidePanel
      .open({ windowId })
      .catch((err) => console.error("[catm] sidePanel.open:", err));
  }
  void runExtractor(tabId)
    .then((payload) => {
      const trimmed = payload?.text.trim();
      if (trimmed) stageText(trimmed, false);
    })
    .catch((err) => console.error("[catm] readPage:", err));
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === SELECTION_MENU_ID) {
    ingestSelection({ text: info.selectionText, windowId: tab?.windowId });
  } else if (info.menuItemId === PAGE_MENU_ID) {
    readPage({ tabId: tab?.id, windowId: tab?.windowId });
  }
});
