import { Readability } from "@mozilla/readability";

const PENDING_KEY = "catm:pending-read";

export interface PendingRead {
  text: string;
  // True for "Read selection" (auto-synth); false for "Read page".
  play: boolean;
}

// Run Readability on copied page HTML. The parsed doc isn't rendered, so use
// textContent (innerText needs layout). Falls back to the most article-like
// element when Readability finds nothing.
function htmlToText(html: string): string {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const text = (new Readability(doc).parse()?.textContent ?? "").trim();
    if (text) return text;
    const el = doc.querySelector("article") ?? doc.querySelector("main") ?? doc.body;
    return el?.textContent?.trim() ?? "";
  } catch {
    return "";
  }
}

function toRead(value: unknown): PendingRead | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { text?: unknown; html?: unknown; play?: unknown };
  const play = v.play === true;
  if (typeof v.text === "string" && v.text.trim().length > 0) return { text: v.text.trim(), play };
  if (typeof v.html === "string" && v.html.trim().length > 0) {
    const text = htmlToText(v.html);
    if (text.length > 0) return { text, play };
  }
  return null;
}

// Drains staged read text from chrome.storage.session, on mount and on change.
// "Read page" stages raw HTML (parsed here); "Read selection" stages text.
export function consumePendingRead(handler: (read: PendingRead) => void): () => void {
  if (typeof chrome === "undefined") return () => {};
  const session = chrome.storage.session;

  const drain = async () => {
    const read = toRead((await session.get(PENDING_KEY))[PENDING_KEY]);
    if (!read) return;
    await session.remove(PENDING_KEY);
    handler(read);
  };

  void drain();

  const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
    if (area !== "session") return;
    if (changes[PENDING_KEY]?.newValue === undefined) return; // removal — ignore
    void drain();
  };
  chrome.storage.onChanged.addListener(onChanged);

  return () => chrome.storage.onChanged.removeListener(onChanged);
}
