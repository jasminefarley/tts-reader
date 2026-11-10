// @ts-check
// Getting readable content out of the page in a tab. Used by the side panel
// ("Read this page" button) and the background worker (right-click menu).
//
// The functions injected into pages (extractFrame, selectedContent) run in the
// page's isolated world, so they must not use anything from this module.

/**
 * @typedef {object} FrameContent
 * @property {boolean} isTop
 * @property {string} url
 * @property {string} title
 * @property {string | null} articleHtml   Readability's main content, if it found any
 * @property {string | null} articleTitle
 * @property {number} articleChars
 * @property {string | null} bodyHtml      the whole body, for frames that are all content
 * @property {number} bodyChars
 * @property {string[]} frameOrigins       origins of the iframes on the page (top frame only)
 */

/**
 * @typedef {{ ok: true, html: string, plain?: string, title: string }
 *   | { ok: false, blockedOrigins: string[] }
 *   | { ok: false, error: string }} ReadResult
 */

const MIN_CHARS = 200;
const ARTIFACT_PAGE = /^https:\/\/claude\.ai\//;

/**
 * Read the main content of the page in a tab, looking inside its frames too.
 * @param {number} tabId
 * @returns {Promise<ReadResult>}
 */
export async function readPage(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["vendor/readability/Readability.js"],
    });
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: extractFrame,
    });
    const frames = results.map((r) => /** @type {FrameContent} */ (r.result)).filter(Boolean);
    return chooseContent(frames);
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

/**
 * Read the current selection in one frame of a tab.
 * @param {number} tabId
 * @param {number} frameId
 * @param {string} [fallbackText] the plain selection text from the context menu
 * @returns {Promise<ReadResult>}
 */
export async function readSelection(tabId, frameId, fallbackText) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      func: selectedContent,
    });
    const content = result?.result;
    if (content?.html) return { ok: true, html: content.html, plain: content.plain, title: "" };
  } catch {
    // No access to that frame: fall back to the text the menu gave us.
  }
  if (fallbackText?.trim()) return { ok: true, html: "", plain: fallbackText, title: "" };
  return { ok: false, error: "Nothing is selected." };
}

/**
 * Pick what to read from everything the frames returned.
 * @param {FrameContent[]} frames
 * @returns {ReadResult}
 */
export function chooseContent(frames) {
  const top = frames.find((f) => f.isTop);
  const bySize = (/** @type {FrameContent} */ a, /** @type {FrameContent} */ b) => b.bodyChars - a.bodyChars;

  // On claude.ai the artifact is in an iframe. Read the whole frame: the
  // artifact is the content, and Readability can drop parts of it.
  if (top && ARTIFACT_PAGE.test(top.url)) {
    const artifact = frames.filter((f) => !f.isTop && f.bodyChars >= MIN_CHARS && f.bodyHtml).sort(bySize)[0];
    if (artifact?.bodyHtml) return { ok: true, html: artifact.bodyHtml, title: artifact.title || top.title };
    // An artifact frame we aren't allowed into yet (ignore analytics and widget frames).
    const blocked = top.frameOrigins.filter((o) => /claude/i.test(o));
    if (blocked.length) return { ok: false, blockedOrigins: blocked };
  }

  if (top?.articleHtml && top.articleChars >= MIN_CHARS) {
    return { ok: true, html: top.articleHtml, title: top.articleTitle || top.title };
  }

  const best = frames.filter((f) => f.bodyHtml && f.bodyChars >= MIN_CHARS).sort(bySize)[0];
  if (best?.bodyHtml) return { ok: true, html: best.bodyHtml, title: best.title || top?.title || "" };

  return { ok: false, error: "Couldn't find readable text on this page." };
}

/** @param {unknown} err */
function describeError(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (/cannot be scripted|cannot access|chrome:\/\/|extensions gallery/i.test(message)) {
    return "Chrome doesn't let extensions read this page.";
  }
  return message;
}

// ---------- injected into pages ----------

/** @returns {FrameContent} */
function extractFrame() {
  const MAX_HTML = 3_000_000;
  const body = document.body;
  const bodyText = body?.innerText?.trim() ?? "";
  const isTop = window === window.top;

  let article = null;
  try {
    // @ts-ignore Readability is injected just before this runs.
    if (isTop && typeof Readability === "function") {
      // @ts-ignore
      article = new Readability(document.cloneNode(true)).parse();
    }
  } catch {
    article = null;
  }

  const frameOrigins = isTop
    ? [
        ...new Set(
          [...document.querySelectorAll("iframe[src]")]
            .map((f) => {
              try {
                return new URL(/** @type {HTMLIFrameElement} */ (f).src, location.href).origin;
              } catch {
                return "";
              }
            })
            .filter((o) => o.startsWith("http") && o !== location.origin)
        ),
      ]
    : [];

  const bodyHtml = body?.innerHTML ?? "";
  return {
    isTop,
    url: location.href,
    title: document.title,
    articleHtml: article?.content ?? null,
    articleTitle: article?.title ?? null,
    articleChars: article?.textContent?.trim().length ?? 0,
    bodyHtml: bodyHtml.length <= MAX_HTML ? bodyHtml : null,
    bodyChars: bodyText.length,
    frameOrigins,
  };
}

function selectedContent() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;
  const holder = document.createElement("div");
  for (let i = 0; i < selection.rangeCount; i++) holder.append(selection.getRangeAt(i).cloneContents());
  return { html: holder.innerHTML, plain: selection.toString() };
}
