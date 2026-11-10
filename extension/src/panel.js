// @ts-check
// Side panel: paste box -> reader view with playback and follow-along.

import { SERVER } from "./config.js";
import { blocksFromHtml } from "./html.js";
import { Player } from "./player.js";
import { AutoScroller, Highlighter, render } from "./reader.js";
import { blocksFromText, preferHtml, toReadBlocks } from "./text.js";

const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2];

/** @template {HTMLElement} T @param {string} id @returns {T} */
const $ = (id) => /** @type {T} */ (document.getElementById(id));

const inputView = $("input-view");
const readerView = $("reader-view");
const pasteBox = /** @type {HTMLTextAreaElement} */ ($("paste"));
const readButton = $("read");
const doc = $("doc");
const banner = $("banner");
const playButton = $("play");
const speedSelect = /** @type {HTMLSelectElement} */ ($("speed"));
const voiceSelect = /** @type {HTMLSelectElement} */ ($("voice"));
const progressBar = $("progress-bar");
const positionLabel = $("position");

const scroller = new AutoScroller(doc);

/** @type {Player | null} */
let player = null;
/** @type {import("./reader.js").Item[]} */
let items = [];
/** @type {Highlighter | null} */
let highlighter = null;

const settings = { speed: 1, voice: /** @type {string | null} */ (null) };

// ---------- startup ----------

for (const s of SPEEDS) speedSelect.add(new Option(`${s}×`, String(s)));
await loadSettings();
speedSelect.value = String(settings.speed);
checkServer();

// ---------- server ----------

async function checkServer() {
  try {
    const res = await fetch(`${SERVER}/voices`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const { default: fallback, voices } = await res.json();
    voiceSelect.replaceChildren(...voices.map((/** @type {string} */ v) => new Option(voiceLabel(v), v)));
    voiceSelect.value = settings.voice && voices.includes(settings.voice) ? settings.voice : fallback;
    hideBanner();
    return true;
  } catch {
    showBanner(
      `Can't reach the local speech server at ${SERVER}. Start it in a terminal with ` +
        `<code>cd server</code> then <code>uv run tts-server</code>, then retry.`
    );
    return false;
  }
}

/** af_sky -> "Sky (American female)" */
function voiceLabel(/** @type {string} */ id) {
  const [prefix, name = id] = id.split("_");
  const accent = { a: "American", b: "British" }[prefix[0]] ?? prefix[0].toUpperCase();
  const gender = { f: "female", m: "male" }[prefix[1]] ?? "";
  return `${name[0].toUpperCase()}${name.slice(1)} (${accent} ${gender})`.replace(" )", ")");
}

/** @param {string} html */
function showBanner(html) {
  banner.innerHTML = `<span>${html}</span> <button type="button" id="retry">Retry</button>`;
  banner.hidden = false;
  $("retry").addEventListener("click", checkServer);
}

function hideBanner() {
  banner.hidden = true;
}

// ---------- settings ----------

async function loadSettings() {
  try {
    const saved = await chrome.storage.local.get(["speed", "voice"]);
    if (typeof saved.speed === "number" && SPEEDS.includes(saved.speed)) settings.speed = saved.speed;
    if (typeof saved.voice === "string") settings.voice = saved.voice;
  } catch {
    // storage unavailable: defaults are fine
  }
}

function saveSettings() {
  chrome.storage.local.set({ speed: settings.speed, voice: settings.voice }).catch(() => {});
}

// ---------- input ----------

pasteBox.addEventListener("paste", (e) => {
  const html = e.clipboardData?.getData("text/html") ?? "";
  const plain = e.clipboardData?.getData("text/plain") ?? "";
  if (!html && !plain) return;
  e.preventDefault();
  open(html, plain);
});

readButton.addEventListener("click", () => open("", pasteBox.value));

$("new").addEventListener("click", () => {
  player?.stop();
  player = null;
  readerView.hidden = true;
  inputView.hidden = false;
  pasteBox.value = "";
  pasteBox.focus();
});

/**
 * @param {string} html
 * @param {string} plain
 */
function open(html, plain) {
  const blocks = html && preferHtml(html) ? blocksFromHtml(html) : blocksFromText(plain);
  const readBlocks = toReadBlocks(blocks);
  if (!readBlocks.length) {
    pasteBox.placeholder = "Nothing readable in that paste. Try copying the text again.";
    return;
  }

  player?.stop();
  items = render(readBlocks, doc);
  highlighter = new Highlighter(items);
  doc.scrollTop = 0;

  player = new Player({ server: SERVER, items, speed: settings.speed, voice: settings.voice });
  player.addEventListener("position", onPosition);
  player.addEventListener("state", onState);
  player.addEventListener("ended", () => {
    positionLabel.textContent = "Finished";
  });
  player.addEventListener("error", (e) => {
    const err = /** @type {CustomEvent<Error>} */ (e).detail;
    console.error(err);
    checkServer().then((up) => {
      if (up) showBanner(`Playback failed: ${err.message}`);
    });
  });

  inputView.hidden = true;
  readerView.hidden = false;
  playButton.focus();
  player.play(0);
}

// ---------- reader ----------

/** Set when the user asked for a jump, so the view follows even mid-hold. */
let forceReveal = false;

function onPosition() {
  if (!player || !highlighter) return;
  const index = player.index;
  highlighter.set(index);
  scroller.reveal(items[index].el, forceReveal);
  forceReveal = false;
  positionLabel.textContent = `${index + 1} / ${items.length}`;
  progressBar.style.width = `${((index + 1) / items.length) * 100}%`;
}

function onState() {
  const playing = player?.playing ?? false;
  playButton.textContent = playing ? "❚❚" : "▶";
  playButton.title = playing ? "Pause (Space)" : "Play (Space)";
  playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
}

/** @param {number} index */
function jumpTo(index) {
  if (!player) return;
  forceReveal = true;
  player.jump(index);
}

/** First item of the block after the current one. */
function nextBlockStart() {
  if (!player) return 0;
  const block = items[player.index].blockEl;
  let i = player.index;
  while (i < items.length && items[i].blockEl === block) i++;
  return Math.min(i, items.length - 1);
}

/** Start of the current block, or of the previous block if already at the start. */
function prevBlockStart() {
  if (!player) return 0;
  let i = player.index;
  const startOf = (/** @type {number} */ j) => {
    const block = items[j].blockEl;
    while (j > 0 && items[j - 1].blockEl === block) j--;
    return j;
  };
  const start = startOf(i);
  if (start < i) return start;
  return i > 0 ? startOf(i - 1) : 0;
}

doc.addEventListener("click", (e) => {
  const target = /** @type {HTMLElement} */ (e.target).closest("[data-index]");
  if (!target || !player) return;
  if (window.getSelection()?.toString()) return; // selecting text, not jumping
  forceReveal = true;
  player.play(Number(/** @type {HTMLElement} */ (target).dataset.index));
});

playButton.addEventListener("click", () => player?.toggle());
$("prev").addEventListener("click", () => player && jumpTo(player.index - 1));
$("next").addEventListener("click", () => player && jumpTo(player.index + 1));
$("prev-block").addEventListener("click", () => jumpTo(prevBlockStart()));
$("next-block").addEventListener("click", () => jumpTo(nextBlockStart()));

speedSelect.addEventListener("change", () => setSpeed(Number(speedSelect.value)));
voiceSelect.addEventListener("change", () => {
  settings.voice = voiceSelect.value;
  saveSettings();
  player?.setVoice(settings.voice);
});

/** @param {number} speed */
function setSpeed(speed) {
  settings.speed = speed;
  speedSelect.value = String(speed);
  saveSettings();
  player?.setSpeed(speed);
}

document.addEventListener("keydown", (e) => {
  if (readerView.hidden || !player) return;
  const target = /** @type {HTMLElement} */ (e.target);
  if (target.matches("input, select, textarea")) return;

  const handled = (() => {
    switch (e.key) {
      case " ":
        player.toggle();
        return true;
      case "ArrowRight":
        jumpTo(e.shiftKey ? nextBlockStart() : player.index + 1);
        return true;
      case "ArrowLeft":
        jumpTo(e.shiftKey ? prevBlockStart() : player.index - 1);
        return true;
      case "[":
      case "]": {
        const i = SPEEDS.indexOf(settings.speed) + (e.key === "]" ? 1 : -1);
        if (i >= 0 && i < SPEEDS.length) setSpeed(SPEEDS[i]);
        return true;
      }
      default:
        return false;
    }
  })();
  if (handled) e.preventDefault();
});
