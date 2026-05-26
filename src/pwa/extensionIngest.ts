// Extension-side share ingest. Replaces the PWA's content-script bridge
// (`bridge.js` + `onExtensionBridge`) for the bundled extension build.
//
// Selection flow:
//   1. User right-clicks → "Read it to me" in the page.
//   2. extension/background.js writes `catm:pending-share` into
//      chrome.storage.session and calls chrome.sidePanel.open().
//   3. This module drains that key when the panel mounts AND on
//      chrome.storage.onChanged (covers the case where the panel was
//      already open when the menu fired).
//
// chrome.storage.session clears on browser restart, so a stale share
// can never resurrect itself days later.

import type { IngestedDraft } from "./ingest";

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

declare const chrome: ChromeGlobal | undefined;

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

// Drain any pending share now and subscribe to future writes. Returns a
// cleanup that removes the listener.
export function consumeExtensionShare(handler: (draft: IngestedDraft) => void): () => void {
  const session = chrome?.storage?.session;
  if (!session || !chrome?.storage) return () => {};

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
  chrome.storage.onChanged.addListener(onChanged);

  return () => {
    chrome?.storage?.onChanged.removeListener(onChanged);
  };
}
