export interface IngestedDraft {
  text: string;
}

const PENDING_KEY = "catm:pending-share";

interface PendingShare {
  text?: unknown;
}

function toDraft(raw: unknown): IngestedDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as PendingShare;
  const text = typeof p.text === "string" ? p.text.trim() : "";
  if (text.length === 0) return null;
  return { text };
}

export function consumeExtensionShare(handler: (draft: IngestedDraft) => void): () => void {
  if (typeof chrome === "undefined") return () => {};
  const session = chrome.storage.session;
  const storage = chrome.storage;

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

  const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
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
