export interface IngestedDraft {
  title: string | null;
  text: string;
}

const PENDING_KEY = "catm:pending-share";

interface PendingShare {
  text?: unknown;
  title?: unknown;
  url?: unknown;
}

interface ChromeStorageChange<T> {
  newValue?: T;
  oldValue?: T;
}

interface ChromeStorageArea {
  get: (key: string) => Promise<Record<string, unknown>>;
  remove: (key: string) => Promise<void>;
}

interface ChromeStorageGlobal {
  session?: ChromeStorageArea;
  onChanged: {
    addListener: (
      cb: (changes: Record<string, ChromeStorageChange<unknown>>, area: string) => void,
    ) => void;
    removeListener: (
      cb: (changes: Record<string, ChromeStorageChange<unknown>>, area: string) => void,
    ) => void;
  };
}

interface ChromeGlobal {
  storage?: ChromeStorageGlobal;
}

// Bare-identifier `chrome` would ReferenceError outside the extension origin.
function getChromeGlobal(): ChromeGlobal | undefined {
  return (globalThis as { chrome?: ChromeGlobal }).chrome;
}

function toDraft(raw: unknown): IngestedDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as PendingShare;
  const text = typeof p.text === "string" ? p.text : "";
  const url = typeof p.url === "string" ? p.url : "";
  const title = typeof p.title === "string" ? p.title.trim() : "";
  const parts = [text, url].filter((s) => s.length > 0);
  if (parts.length === 0 && !title) return null;
  return { title: title || null, text: parts.join("\n\n").trim() };
}

export function consumeExtensionShare(handler: (draft: IngestedDraft) => void): () => void {
  const chromeGlobal = getChromeGlobal();
  const session = chromeGlobal?.storage?.session;
  const storage = chromeGlobal?.storage;
  if (!session || !storage) return () => {};

  const drain = async () => {
    try {
      const out = await session.get(PENDING_KEY);
      const draft = toDraft(out[PENDING_KEY]);
      if (!draft) return;
      await session.remove(PENDING_KEY);
      handler(draft);
    } catch (err) {
      console.error("[catm] extensionIngest drain:", err);
    }
  };

  void drain();

  const onChanged = (changes: Record<string, ChromeStorageChange<unknown>>, area: string) => {
    if (area !== "session") return;
    if (!(PENDING_KEY in changes)) return;
    if (changes[PENDING_KEY]?.newValue === undefined) return; // removal — ignore
    void drain();
  };
  storage.onChanged.addListener(onChanged);

  return () => {
    storage.onChanged.removeListener(onChanged);
  };
}
