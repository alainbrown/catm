// Rendered only inside the side panel (IS_SIDE_PANEL). Opens the same
// bundled app in a tab via `chrome.tabs.create`, then closes the panel
// so we never have two views fighting over the same OPFS / IDB.

interface ChromeTabs {
  create: (opts: { url: string }) => Promise<unknown>;
}
interface ChromeRuntime {
  getURL: (path: string) => string;
}
interface ChromeGlobal {
  tabs?: ChromeTabs;
  runtime?: ChromeRuntime;
}
declare const chrome: ChromeGlobal | undefined;

async function popOut(): Promise<void> {
  const url = chrome?.runtime?.getURL("app/index.html?ctx=tab");
  if (!url || !chrome?.tabs) return;
  try {
    await chrome.tabs.create({ url });
  } catch (err) {
    console.error("[catm] popout failed:", err);
    return;
  }
  // One view at a time. Closing the panel disposes the document and frees
  // the worker — segments already in OPFS persist for the tab to read.
  window.close();
}

export function PopoutButton(): React.JSX.Element {
  return (
    <button
      type="button"
      className="popout-btn"
      onClick={() => void popOut()}
      title="Open in tab"
      aria-label="Open in tab"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 3h4v4" />
        <path d="M13 3l-6 6" />
        <path d="M11 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3" />
      </svg>
    </button>
  );
}
