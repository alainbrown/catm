const CATM_ORIGIN = "https://catm-app.github.io";
const CATM_MATCH = `${CATM_ORIGIN}/*`;
const MENU_ID = "send-selection-to-catm";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Send selection to catm",
    contexts: ["selection"],
  });
});

async function openCatm(targetUrl) {
  const [existing] = await chrome.tabs.query({ url: CATM_MATCH });
  if (existing?.id != null) {
    await chrome.tabs.update(existing.id, { active: true, url: targetUrl });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url: targetUrl });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  const text = info.selectionText?.trim();
  if (!text) return;

  const url = new URL(CATM_ORIGIN + "/");
  url.searchParams.set("text", text);
  if (tab?.title) url.searchParams.set("title", tab.title);
  if (tab?.url) url.searchParams.set("url", tab.url);
  await openCatm(url.toString());
});

chrome.action.onClicked.addListener(() => {
  openCatm(`${CATM_ORIGIN}/`);
});
