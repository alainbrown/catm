// Runs at document_start on the catm origin. Drains any pending share that
// background.js stashed in chrome.storage.local into the page's
// sessionStorage, then signals the app to ingest it. Keeps the payload off
// the URL so long selections don't blow the URL length limit.

const PENDING_KEY = "catm:pending-share";

(async () => {
  try {
    const out = await chrome.storage.local.get(PENDING_KEY);
    const pending = out[PENDING_KEY];
    if (!pending || typeof pending.text !== "string" || pending.text.length === 0) return;
    await chrome.storage.local.remove(PENDING_KEY);
    try {
      window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
    } catch (err) {
      console.error("[catm-ext] sessionStorage write failed:", err);
      return;
    }
    window.dispatchEvent(new CustomEvent("catm:share-ready"));
  } catch (err) {
    console.error("[catm-ext] bridge failed:", err);
  }
})();
