const CATM_ORIGIN = "https://catm-app.github.io";
const CATM_MATCH = `${CATM_ORIGIN}/*`;
const MENU_ID = "send-selection-to-catm";
const PENDING_KEY = "catm:pending-share";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Send selection to catm",
    contexts: ["selection"],
  });
});

async function openCatm() {
  const targetUrl = `${CATM_ORIGIN}/`;
  const [existing] = await chrome.tabs.query({ url: CATM_MATCH });
  if (existing?.id != null) {
    // Reload so the content script re-runs and picks up the pending share.
    await chrome.tabs.update(existing.id, { active: true, url: targetUrl });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: targetUrl });
}

// Extracted so e2e tests can drive the bridge end-to-end: there is no public
// API to fire `chrome.contextMenus.onClicked` programmatically, so the test
// invokes this function via `serviceWorker.evaluate(...)` instead.
async function handleSelection({ text, tabTitle, tabUrl }) {
  const trimmed = text?.trim();
  if (!trimmed) return;
  await chrome.storage.local.set({
    [PENDING_KEY]: {
      text: trimmed,
      title: tabTitle ?? null,
      url: tabUrl ?? null,
      ts: Date.now(),
    },
  });
  await openCatm();
}
globalThis.__catmHandleSelection = handleSelection;

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  await handleSelection({ text: info.selectionText, tabTitle: tab?.title, tabUrl: tab?.url });
});

chrome.action.onClicked.addListener(() => {
  openCatm();
});
