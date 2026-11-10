// @ts-check
// Pure text handling: turns pasted text into blocks and blocks into speakable
// sentences. No DOM here, so it runs under `node --test`.

/** @typedef {"heading" | "paragraph" | "listItem" | "quote" | "code" | "table"} BlockType */
/** @typedef {{ type: BlockType, text: string, level?: number, lines?: number, rows?: number }} Block */
/** @typedef {{ display: string, speech: string, pauseAfter: number, skipped?: boolean }} Sentence */
/** @typedef {{ block: Block, sentences: Sentence[] }} ReadBlock */

export const LIMITS = {
  /** Longer sentences are split, so audio for each chunk starts quickly. */
  maxChars: 300,
  /** The very first chunk is kept shorter, so reading starts within a second or two. */
  firstMaxChars: 160,
  /** Fragments shorter than this are merged into a neighbour. */
  minWords: 4,
};

/** Silence after each kind of item, in milliseconds. */
export const PAUSES = { sentence: 150, listItem: 300, paragraph: 350, heading: 600, skipped: 400 };

/** A segment ending in one of these doesn't end a sentence ("Dr. Smith"). */
const NO_BREAK_AFTER = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|cf|approx|Fig|e\.g|i\.e)\.$/i;

/** @type {[RegExp, string][]} */
const SPOKEN_REPLACEMENTS = [
  [/\be\.g\./gi, "for example"],
  [/\bi\.e\./gi, "that is"],
  [/\betc\./gi, "etcetera"],
  [/\bvs\.(?=\s)/gi, "versus"],
  [/\s&\s/g, " and "],
];

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** @param {string} s */
const wordCount = (s) => s.split(/\s+/).filter(Boolean).length;

/** @param {string} s */
export const collapse = (s) => s.replace(/\s+/g, " ").trim();

/** @typedef {{ from: string, to: string }} Pronunciation */

/**
 * Starting list, shown in the editor. One `written = spoken` per line.
 * Checked against Kokoro's phonemizer: lowercase "uat" comes out as "you-at",
 * and spelling letters with spaces ("U A T") reads the lone "A" as the word "a",
 * so letters are spelled as one hyphenated word instead.
 */
export const DEFAULT_PRONUNCIATIONS = `# One per line: written = spoken. Matches whole words, case-sensitive.
# Tip: spell letters as one hyphenated word ("you-eh-tee"), not with spaces ("U A T").
uat = you-eh-tee
UAT = you-eh-tee
K-1s = K-ones
K-2s = K-twos
K-3s = K-threes
ONNX = onyx
`;

/**
 * @param {string} text the editor contents
 * @returns {Pronunciation[]}
 */
export function parsePronunciations(text) {
  /** @type {Pronunciation[]} */
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const from = trimmed.slice(0, eq).trim();
    const to = trimmed.slice(eq + 1).trim();
    if (from && to) rules.push({ from, to });
  }
  // Longest first, so "K-1 form" wins over "K-1" if both are listed.
  return rules.sort((a, b) => b.from.length - a.from.length);
}

/**
 * Replace whole-word matches. "UAT" matches in "UAT," and "(UAT)" but not in "UATS".
 * @param {string} text
 * @param {Pronunciation[]} rules
 */
export function applyPronunciations(text, rules) {
  let s = text;
  for (const { from, to } of rules) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, "g"), to);
  }
  return s;
}

/**
 * What the voice should say for a piece of display text.
 * @param {string} text
 * @param {Pronunciation[]} [pronunciations]
 */
export function speechFor(text, pronunciations = []) {
  let s = applyPronunciations(text, pronunciations);
  s = s.replace(/https?:\/\/[^\s)>\]]+/g, (url) => {
    try {
      return `link to ${new URL(url).hostname.replace(/^www\./, "")}`;
    } catch {
      return "link";
    }
  });
  s = s.replace(/\*\*|__|`/g, "");
  for (const [pattern, words] of SPOKEN_REPLACEMENTS) s = s.replace(pattern, words);
  // snake_case -> "snake case", camelCase -> "camel Case"
  s = s.replace(/\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g, (m) => m.replace(/_/g, " "));
  s = s.replace(/\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g, (m) => m.replace(/([a-z0-9])([A-Z])/g, "$1 $2"));
  return collapse(s);
}

/**
 * Remove inline markdown from plain text: links and images keep their text,
 * emphasis markers and backticks go.
 * @param {string} text
 */
export function stripInlineMarkdown(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|__/g, "")
    .replace(/(^|[\s(])\*(\S(?:[^*]*\S)?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`/g, "");
}

/**
 * Split text at the latest good boundary so no chunk is longer than `max`.
 * @param {string} text
 * @param {number} max
 * @returns {string[]}
 */
export function splitLong(text, max) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = -1;
    // Prefer strong punctuation, then commas, then any space. Never cut in
    // the first 40% of the window, so chunks don't get tiny.
    for (const boundary of [/[;:–—](?=\s)/g, /,(?=\s)/g, /\s/g]) {
      let match;
      while ((match = boundary.exec(window))) {
        if (match.index >= max * 0.4) cut = match.index + 1;
      }
      if (cut > 0) break;
    }
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Split a paragraph into sentences sized for speaking.
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function splitSentences(text, maxChars = LIMITS.maxChars) {
  const raw = [...segmenter.segment(collapse(text))].map((s) => s.segment.trim()).filter(Boolean);

  /** @type {string[]} */
  const joined = [];
  for (const segment of raw) {
    const prev = joined.at(-1);
    if (prev !== undefined && NO_BREAK_AFTER.test(prev)) joined[joined.length - 1] = `${prev} ${segment}`;
    else joined.push(segment);
  }

  /** @type {string[]} */
  const merged = [];
  for (const segment of joined) {
    if (merged.length && wordCount(segment) < LIMITS.minWords) merged[merged.length - 1] += ` ${segment}`;
    else merged.push(segment);
  }
  if (merged.length > 1 && wordCount(merged[0]) < LIMITS.minWords) {
    merged[1] = `${merged[0]} ${merged[1]}`;
    merged.shift();
  }

  return merged.flatMap((s) => splitLong(s, maxChars));
}

/** @param {number} n @param {string} word */
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Turn blocks into what the reader shows and says.
 * @param {Block[]} blocks
 * @param {{ pronunciations?: Pronunciation[] }} [options]
 * @returns {ReadBlock[]}
 */
export function toReadBlocks(blocks, { pronunciations = [] } = {}) {
  let first = true;
  /** @type {ReadBlock[]} */
  const result = [];

  for (const block of blocks) {
    /** @type {Sentence[]} */
    let sentences;
    if (block.type === "code") {
      const lines = block.lines ?? block.text.split("\n").length;
      sentences = [
        {
          display: block.text,
          speech: `Code block, ${plural(lines, "line")}, skipped.`,
          pauseAfter: PAUSES.skipped,
          skipped: true,
        },
      ];
    } else if (block.type === "table") {
      sentences = [
        {
          display: block.text,
          speech: `Table with ${plural(block.rows ?? 0, "row")}, skipped.`,
          pauseAfter: PAUSES.skipped,
          skipped: true,
        },
      ];
    } else if (block.type === "heading") {
      sentences = [{ display: block.text, speech: speechFor(block.text, pronunciations), pauseAfter: PAUSES.heading }];
    } else {
      let parts = splitSentences(block.text);
      if (first && parts.length) parts = [...splitLong(parts[0], LIMITS.firstMaxChars), ...parts.slice(1)];
      const endPause = block.type === "listItem" ? PAUSES.listItem : PAUSES.paragraph;
      sentences = parts.map((display, i) => ({
        display,
        speech: speechFor(display, pronunciations),
        pauseAfter: i === parts.length - 1 ? endPause : PAUSES.sentence,
      }));
    }

    sentences = sentences.filter((s) => s.speech);
    if (!sentences.length) continue;
    if (sentences.some((s) => !s.skipped)) first = false;
    result.push({ block, sentences });
  }
  return result;
}

/**
 * Parse plain text, understanding the markdown that Claude output usually has.
 * @param {string} text
 * @returns {Block[]}
 */
export function blocksFromText(text) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  /** @type {Block[]} */
  const blocks = [];
  /** @type {string[]} */
  let paragraph = [];
  let paragraphType = /** @type {BlockType} */ ("paragraph");

  const flush = () => {
    const content = collapse(stripInlineMarkdown(paragraph.join(" ")));
    if (content) blocks.push({ type: paragraphType, text: content });
    paragraph = [];
    paragraphType = "paragraph";
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    const fence = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      flush();
      const code = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) code.push(lines[i]);
      blocks.push({ type: "code", text: code.join("\n"), lines: code.length });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      continue;
    }
    const heading = trimmed.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length, text: collapse(stripInlineMarkdown(heading[2])) });
      continue;
    }
    if (trimmed.startsWith("|")) {
      flush();
      const rows = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push(lines[i].trim());
      i--;
      const contentRows = rows.filter((r) => !/^\|[\s:|-]+\|?$/.test(r));
      blocks.push({ type: "table", text: rows.join("\n"), rows: Math.max(0, contentRows.length - 1) });
      continue;
    }
    const item = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      blocks.push({ type: "listItem", text: collapse(stripInlineMarkdown(item[1])) });
      continue;
    }
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      if (paragraphType !== "quote") flush();
      paragraphType = "quote";
      paragraph.push(quote[1]);
      continue;
    }
    if (paragraphType === "quote") flush();
    paragraph.push(trimmed);
  }
  flush();
  return blocks.filter((b) => b.text.trim());
}

/**
 * Use the HTML flavour of a paste only when it has real document structure.
 * Code editors put plain text in HTML with only <div>s and <span>s; their plain
 * text (often markdown) is the better source.
 * @param {string} html
 */
export function preferHtml(html) {
  return /<(?:p|h[1-6]|li|table|blockquote)[\s>]/i.test(html);
}
