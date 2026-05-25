// Pulls text into catm from external launch sources:
//
//   - share_target (manifest): incoming `?title=&text=&url=` query params
//   - file_handlers (manifest): `window.launchQueue` delivering one or more
//     FileSystemFileHandle entries for .txt / .md
//   - browser extension bridge: text written into sessionStorage under
//     `catm:pending-share` by the "Send to catm" extension's content script,
//     accompanied by a `catm:share-ready` window event (handoff avoids the
//     URL length cap that would break long right-click selections)
//
// Each surface produces a single string of text; the caller decides how to
// load it (typically: only ingest into an empty draft, otherwise prompt).

export interface IngestedDraft {
  title: string | null;
  text: string;
}

function joinShareParams(params: URLSearchParams): IngestedDraft | null {
  const title = params.get("title");
  const text = params.get("text");
  const url = params.get("url");
  const parts = [text, url].filter((p): p is string => !!p && p.length > 0);
  if (parts.length === 0 && !title) return null;
  return {
    title: title?.trim() || null,
    text: parts.join("\n\n").trim(),
  };
}

// Read the share_target params from `location.search`, then strip them so a
// reload doesn't re-ingest. Returns null if no relevant params present.
export function consumeShareTarget(): IngestedDraft | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("title") && !params.has("text") && !params.has("url")) return null;
  const draft = joinShareParams(params);
  // Clean the URL so refresh doesn't repeat the import.
  const clean = window.location.pathname + window.location.hash;
  window.history.replaceState(null, "", clean);
  return draft;
}

const PENDING_SHARE_KEY = "catm:pending-share";

interface PendingShare {
  text?: unknown;
  title?: unknown;
  url?: unknown;
}

function readPendingShare(): IngestedDraft | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(PENDING_SHARE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    window.sessionStorage.removeItem(PENDING_SHARE_KEY);
  } catch {
    /* best-effort */
  }
  let parsed: PendingShare;
  try {
    parsed = JSON.parse(raw) as PendingShare;
  } catch {
    return null;
  }
  const text = typeof parsed.text === "string" ? parsed.text : "";
  const url = typeof parsed.url === "string" ? parsed.url : "";
  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  const parts = [text, url].filter((p) => p.length > 0);
  if (parts.length === 0 && !title) return null;
  return { title: title || null, text: parts.join("\n\n").trim() };
}

// Drain text stashed by the "Send to catm" extension. The extension's content
// script writes sessionStorage before the page mounts and fires
// `catm:share-ready`; we check immediately and also listen for the event in
// case the storage write races React mount.
export function onExtensionBridge(handler: (draft: IngestedDraft) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const drain = () => {
    const draft = readPendingShare();
    if (draft) handler(draft);
  };
  drain();
  const listener = () => drain();
  window.addEventListener("catm:share-ready", listener);
  return () => window.removeEventListener("catm:share-ready", listener);
}

interface LaunchParams {
  files?: FileSystemFileHandle[];
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void | Promise<void>): void;
}
declare global {
  interface Window {
    launchQueue?: LaunchQueue;
  }
}

// Subscribe to file_handlers launches. The consumer fires once per launch with
// the files the OS handed us. Returns a no-op cleanup (the API has no
// unsubscribe — setConsumer overwrites any previous consumer).
export function onFileLaunch(handler: (draft: IngestedDraft) => void): () => void {
  if (typeof window === "undefined" || !window.launchQueue) return () => {};
  let cancelled = false;
  window.launchQueue.setConsumer(async (params) => {
    if (cancelled || !params.files || params.files.length === 0) return;
    try {
      // Multiple files → concatenate, separated by a header line per file.
      // Most launches will be a single file.
      const parts: string[] = [];
      let firstName: string | null = null;
      for (const handle of params.files) {
        const file = await handle.getFile();
        const text = await file.text();
        firstName ??= file.name;
        parts.push(params.files.length > 1 ? `# ${file.name}\n\n${text}` : text);
      }
      handler({
        title: firstName ? firstName.replace(/\.(txt|md|markdown)$/i, "") : null,
        text: parts.join("\n\n").trim(),
      });
    } catch (err) {
      console.error("[catm] file_handler launch failed:", err);
    }
  });
  return () => {
    cancelled = true;
  };
}
