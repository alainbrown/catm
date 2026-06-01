import { Readability } from "@mozilla/readability";

// Injected on demand by the service worker (chrome.scripting + ?script) when the
// user picks "Read page". Runs in the page's isolated world, pulls the main
// readable content with Readability — cloning the document so the live page is
// untouched — and messages the result back. Falls back to the most article-like
// element's innerText when Readability finds no article (apps, dashboards, feeds).
export interface PageTextPayload {
  title: string;
  url: string;
  text: string;
}

export function extract(): PageTextPayload {
  const url = location.href;
  let title = document.title;
  let text = "";

  try {
    const article = new Readability(document.cloneNode(true) as Document).parse();
    if (article) {
      text = (article.textContent ?? "").trim();
      if (article.title) title = article.title;
    }
  } catch {
    // Readability can throw on unusual DOMs; fall through to innerText.
  }

  if (!text) {
    const root =
      document.querySelector("article") ?? document.querySelector("main") ?? document.body;
    text = (root instanceof HTMLElement ? root.innerText : "").trim();
  }

  return { title: title || url, url, text };
}

chrome.runtime.sendMessage({ type: "catm-page-text", payload: extract() });
