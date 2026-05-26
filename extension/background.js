const MENU_ID = "catm-read-selection";
const PENDING_KEY = "catm:pending-share";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Read it to me",
    contexts: ["selection"],
  });
});

// Icon click opens the side panel (instead of firing chrome.action.onClicked).
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[catm] setPanelBehavior:", err));

// Extracted so e2e can drive the ingest end-to-end: there is no public API
// to fire `chrome.contextMenus.onClicked` programmatically, so tests invoke
// this via `serviceWorker.evaluate(...)`.
function ingestSelection({ text, tabTitle, tabUrl, windowId }) {
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
  chrome.storage.session
    .set({
      [PENDING_KEY]: {
        text: trimmed,
        title: tabTitle ?? null,
        url: tabUrl ?? null,
        ts: Date.now(),
      },
    })
    .catch((err) => console.error("[catm] storage.session.set:", err));
}
globalThis.__catmIngestSelection = ingestSelection;

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  ingestSelection({
    text: info.selectionText,
    tabTitle: tab?.title,
    tabUrl: tab?.url,
    windowId: tab?.windowId,
  });
});
