// @ts-check
// Renders read blocks, highlights the current sentence and keeps it in view.

/** @typedef {import("./text.js").ReadBlock} ReadBlock */
/** @typedef {{ display: string, speech: string, pauseAfter: number, skipped: boolean, el: HTMLElement, blockEl: HTMLElement }} Item */

/**
 * @param {ReadBlock[]} readBlocks
 * @param {HTMLElement} root
 * @returns {Item[]}
 */
export function render(readBlocks, root) {
  root.replaceChildren();
  /** @type {Item[]} */
  const items = [];

  for (const { block, sentences } of readBlocks) {
    /** @type {HTMLElement} */
    let blockEl;
    if (block.type === "code" || block.type === "table") {
      blockEl = document.createElement("pre");
      blockEl.className = `skipped ${block.type}`;
      blockEl.textContent = sentences[0].display;
      blockEl.title = sentences[0].speech;
      blockEl.dataset.index = String(items.length);
      items.push({ display: sentences[0].display, speech: sentences[0].speech, pauseAfter: sentences[0].pauseAfter, skipped: true, el: blockEl, blockEl });
      root.append(blockEl);
      continue;
    }

    if (block.type === "heading") {
      blockEl = document.createElement(`h${Math.min(Math.max(block.level ?? 2, 1), 4)}`);
    } else if (block.type === "quote") {
      blockEl = document.createElement("blockquote");
    } else {
      blockEl = document.createElement("p");
      if (block.type === "listItem") blockEl.className = "list-item";
    }

    sentences.forEach((sentence, i) => {
      const span = document.createElement("span");
      span.className = "sentence";
      span.textContent = sentence.display;
      span.dataset.index = String(items.length);
      if (i > 0) blockEl.append(" ");
      blockEl.append(span);
      items.push({ display: sentence.display, speech: sentence.speech, pauseAfter: sentence.pauseAfter, skipped: false, el: span, blockEl });
    });
    root.append(blockEl);
  }
  return items;
}

/** Moves the highlight. Marks everything before the current item as read. */
export class Highlighter {
  /** @param {Item[]} items */
  constructor(items) {
    this.items = items;
    this.current = -1;
  }

  /** @param {number} index */
  set(index) {
    const prev = this.items[this.current];
    if (prev) {
      prev.el.classList.remove("current");
      prev.blockEl.classList.remove("current-block");
    }
    // Update "read" only for the range that changed.
    const lo = Math.min(Math.max(this.current, 0), index);
    const hi = Math.max(this.current, index);
    for (let i = lo; i <= hi && i < this.items.length; i++) {
      this.items[i].el.classList.toggle("read", i < index);
    }
    const item = this.items[index];
    item.el.classList.add("current");
    item.blockEl.classList.add("current-block");
    this.current = index;
  }
}

/**
 * Keeps the current sentence in view, about a third of the way down. Stays out
 * of the way for a few seconds after you scroll yourself.
 */
export class AutoScroller {
  /** @param {HTMLElement} container */
  constructor(container, holdMs = 5000) {
    this.container = container;
    this.holdMs = holdMs;
    this.heldUntil = 0;
    const hold = () => {
      this.heldUntil = Date.now() + this.holdMs;
    };
    container.addEventListener("wheel", hold, { passive: true });
    container.addEventListener("touchmove", hold, { passive: true });
    container.addEventListener("pointerdown", (e) => {
      // A press on the scrollbar itself.
      if (e.offsetX > container.clientWidth) hold();
    });
  }

  /**
   * @param {HTMLElement} el
   * @param {boolean} [force] ignore the hold (used after jumps the user asked for)
   */
  reveal(el, force = false) {
    if (!force && Date.now() < this.heldUntil) return;
    const box = this.container.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const top = rect.top - box.top;
    const visible = top >= box.height * 0.1 && rect.bottom - box.top <= box.height * 0.65;
    if (visible && !force) return;
    this.container.scrollTo({
      top: this.container.scrollTop + top - box.height / 3,
      behavior: "smooth",
    });
  }
}
