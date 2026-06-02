const PENDING_KEY = "catm:pending-read";
const ROOT_MENU_ID = "catm-root";
const PAGE_MENU_ID = "catm-read-page";
const SELECTION_MENU_ID = "catm-read-selection";

interface PendingRead {
  text?: string;
  html?: string;
  play: boolean;
}

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

// Make the toolbar icon open the side panel (instead of firing
// chrome.action.onClicked).
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("[catm] setPanelBehavior:", err));

// Stash text/HTML for the side panel to pick up. Exposed on globalThis so e2e
// can drive panel delivery without a real content tab.
function stage(pending: PendingRead): void {
  chrome.storage.session
    .set({ [PENDING_KEY]: pending })
    .catch((err) => console.error("[catm] storage.session.set:", err));
}
(globalThis as typeof globalThis & { __catmStage?: typeof stage }).__catmStage = stage;

// Open synchronously within the click gesture (an await first loses it).
function openPanel(windowId: number | undefined): void {
  if (windowId == null) return;
  chrome.sidePanel.open({ windowId }).catch((err) => console.error("[catm] sidePanel.open:", err));
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab) return;
  if (info.menuItemId === SELECTION_MENU_ID) {
    const text = info.selectionText?.trim();
    openPanel(tab.windowId);
    if (text) stage({ text, play: true });
  } else if (info.menuItemId === PAGE_MENU_ID && tab.id != null) {
    const tabId = tab.id;
    openPanel(tab.windowId);
    // Copy the page's HTML out; the side panel runs Readability on it. activeTab
    // (granted by the click) covers the injection — no host permission needed.
    chrome.scripting
      .executeScript({ target: { tabId }, func: () => document.documentElement.outerHTML })
      .then(([res]) => {
        const html = (res?.result as string) ?? "";
        if (html.trim()) stage({ html, play: false });
      })
      .catch((err) => console.error("[catm] read page:", err));
  }
});
