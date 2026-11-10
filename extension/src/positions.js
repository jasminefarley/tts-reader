// @ts-check
// Remembers where you stopped in each thing you read, keyed by a hash of its
// text, so the same artifact or article resumes whether it came from the page,
// a selection or a paste.

const PREFIX = "pos:";
const MAX_SAVED = 200;
const SAVE_DELAY_MS = 800;

/** @type {ReturnType<typeof setTimeout> | null} */
let saveTimer = null;

/**
 * @param {string[]} texts the display text of every item, in order
 * @returns {Promise<string>}
 */
export async function positionKey(texts) {
  const bytes = new TextEncoder().encode(texts.join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return PREFIX + hex.slice(0, 32);
}

/**
 * Where to start: the saved position, or 0 when there's nothing worth resuming.
 * @param {string} key
 * @param {number} total
 */
export async function savedPosition(key, total) {
  try {
    const { [key]: saved } = await chrome.storage.local.get(key);
    if (saved && saved.total === total && saved.index > 0 && saved.index < total - 1) return saved.index;
  } catch {
    // storage unavailable: start at the top
  }
  return 0;
}

/**
 * Debounced, so moving through sentences doesn't write on every one.
 * @param {string} key
 * @param {number} index
 * @param {number} total
 */
export function savePosition(key, index, total) {
  if (!key) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    chrome.storage.local
      .set({ [key]: { index, total, at: Date.now() } })
      .then(prune)
      .catch(() => {});
  }, SAVE_DELAY_MS);
}

/** @param {string} key */
export function forgetPosition(key) {
  if (!key) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  chrome.storage.local.remove(key).catch(() => {});
}

/** Keep only the most recent positions. */
async function prune() {
  const all = await chrome.storage.local.get(null);
  const saved = Object.entries(all)
    .filter(([k]) => k.startsWith(PREFIX))
    .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0));
  if (saved.length > MAX_SAVED) await chrome.storage.local.remove(saved.slice(MAX_SAVED).map(([k]) => k));
}
