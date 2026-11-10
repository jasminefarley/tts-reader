// @ts-check
// Turns pasted HTML into blocks. Needs a DOM (DOMParser), so it only runs in Chrome.

import { collapse } from "./text.js";

/** @typedef {import("./text.js").Block} Block */
/** @typedef {import("./text.js").BlockType} BlockType */

const DROP = "script, style, noscript, template, svg, iframe, button, input, select, textarea, nav";

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIGCAPTION",
  "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN",
  "OL", "P", "PRE", "SECTION", "SUMMARY", "TABLE", "UL",
]);

/**
 * @param {string} html
 * @returns {Block[]}
 */
export function blocksFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(DROP).forEach((el) => el.remove());
  /** @type {Block[]} */
  const blocks = [];
  walk(doc.body, blocks, "paragraph");
  return blocks.filter((b) => b.text.trim());
}

/**
 * Inline content is gathered into a run and becomes one block when a block
 * element (or the end of the container) is reached.
 * @param {Element} container
 * @param {Block[]} blocks
 * @param {BlockType} type
 */
function walk(container, blocks, type) {
  let inline = "";
  const flush = () => {
    const text = collapse(inline);
    if (text) blocks.push({ type, text });
    inline = "";
  };

  for (const node of container.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      inline += node.textContent ?? "";
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = node.tagName;

    if (tag === "BR") {
      inline += " ";
      continue;
    }
    if (tag === "IMG") {
      const alt = node.getAttribute("alt")?.trim();
      if (alt) inline += ` ${alt} `;
      continue;
    }
    if (!BLOCK_TAGS.has(tag)) {
      inline += node.textContent ?? "";
      continue;
    }

    flush();
    if (/^H[1-6]$/.test(tag)) {
      blocks.push({ type: "heading", level: Number(tag[1]), text: collapse(node.textContent ?? "") });
    } else if (tag === "PRE") {
      const code = (node.textContent ?? "").replace(/\n+$/, "");
      blocks.push({ type: "code", text: code, lines: code.split("\n").length });
    } else if (tag === "TABLE") {
      const rows = [...node.querySelectorAll("tr")];
      const hasHeader = rows.length > 0 && rows[0].querySelector("th") !== null;
      const text = rows
        .map((row) => [...row.children].map((cell) => collapse(cell.textContent ?? "")).join(" | "))
        .join("\n");
      blocks.push({ type: "table", text, rows: rows.length - (hasHeader ? 1 : 0) });
    } else if (tag === "LI") {
      walk(node, blocks, "listItem");
    } else if (tag === "BLOCKQUOTE") {
      walk(node, blocks, "quote");
    } else if (tag !== "HR") {
      walk(node, blocks, type);
    }
  }
  flush();
}
