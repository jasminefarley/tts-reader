import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LIMITS,
  PAUSES,
  blocksFromText,
  preferHtml,
  speechFor,
  splitLong,
  splitSentences,
  stripInlineMarkdown,
  toReadBlocks,
} from "../src/text.js";

describe("splitSentences", () => {
  it("splits ordinary prose", () => {
    assert.deepEqual(splitSentences("The load ran at noon today. It added two new columns. Nothing failed."), [
      "The load ran at noon today.",
      "It added two new columns. Nothing failed.",
    ]);
  });

  it("does not break after titles like Dr.", () => {
    assert.deepEqual(splitSentences("We spoke with Dr. Smith about the plan. She agreed with all of it."), [
      "We spoke with Dr. Smith about the plan.",
      "She agreed with all of it.",
    ]);
  });

  it("merges a short leading fragment into the next sentence", () => {
    assert.deepEqual(splitSentences("Hi. This is the first real sentence here."), [
      "Hi. This is the first real sentence here.",
    ]);
  });

  it("splits sentences longer than the limit", () => {
    const long = `${"word ".repeat(80).trim()}.`;
    const parts = splitSentences(long);
    assert.ok(parts.length > 1);
    assert.ok(parts.every((p) => p.length <= LIMITS.maxChars));
    assert.equal(parts.join(" "), long);
  });
});

describe("splitLong", () => {
  it("prefers punctuation over plain spaces", () => {
    const text = "The extension owns the structure of the document; the server only speaks short strings of text.";
    assert.deepEqual(splitLong(text, 60), [
      "The extension owns the structure of the document;",
      "the server only speaks short strings of text.",
    ]);
  });

  it("leaves short text alone", () => {
    assert.deepEqual(splitLong("Short.", 100), ["Short."]);
  });

  it("cuts unbroken text at the limit", () => {
    assert.deepEqual(splitLong("x".repeat(25), 10), ["x".repeat(10), "x".repeat(10), "x".repeat(5)]);
  });
});

describe("speechFor", () => {
  it("speaks URLs as their domain", () => {
    assert.equal(speechFor("See https://www.example.com/a/b?c=1 for more."), "See link to example.com for more.");
  });

  it("expands common abbreviations", () => {
    assert.equal(speechFor("Formats, e.g. Parquet, i.e. columnar & fast."), "Formats, for example Parquet, that is columnar and fast.");
  });

  it("splits identifiers into words", () => {
    assert.equal(speechFor("Set on_schema_change in getUserName."), "Set on schema change in get User Name.");
  });

  it("drops markdown markers", () => {
    assert.equal(speechFor("This is **bold** and `code`."), "This is bold and code.");
  });
});

describe("stripInlineMarkdown", () => {
  it("keeps link and image text", () => {
    assert.equal(stripInlineMarkdown("Read [the docs](https://x.y) and ![a chart](c.png)."), "Read the docs and a chart.");
  });

  it("removes emphasis but keeps snake_case", () => {
    assert.equal(stripInlineMarkdown("*Really* **important** for my_table_name"), "Really important for my_table_name");
  });
});

describe("blocksFromText", () => {
  const md = [
    "# Title",
    "",
    "First paragraph line one",
    "continues here.",
    "",
    "- item one",
    "2. item two",
    "",
    "> quoted text",
    "",
    "```sql",
    "select 1;",
    "select 2;",
    "```",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
    "| 3 | 4 |",
    "",
    "---",
    "Last.",
  ].join("\n");

  it("recognises markdown structure", () => {
    assert.deepEqual(blocksFromText(md), [
      { type: "heading", level: 1, text: "Title" },
      { type: "paragraph", text: "First paragraph line one continues here." },
      { type: "listItem", text: "item one" },
      { type: "listItem", text: "item two" },
      { type: "quote", text: "quoted text" },
      { type: "code", text: "select 1;\nselect 2;", lines: 2 },
      { type: "table", text: "| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |", rows: 2 },
      { type: "paragraph", text: "Last." },
    ]);
  });

  it("handles Windows line endings", () => {
    assert.deepEqual(blocksFromText("One.\r\n\r\nTwo."), [
      { type: "paragraph", text: "One." },
      { type: "paragraph", text: "Two." },
    ]);
  });
});

describe("toReadBlocks", () => {
  it("skips code and tables with a short spoken note", () => {
    const read = toReadBlocks([
      { type: "code", text: "a\nb\nc", lines: 3 },
      { type: "table", text: "x", rows: 1 },
    ]);
    assert.deepEqual(
      read.map((r) => r.sentences[0].speech),
      ["Code block, 3 lines, skipped.", "Table with 1 row, skipped."]
    );
    assert.ok(read.every((r) => r.sentences[0].skipped));
  });

  it("uses longer pauses at the end of headings and paragraphs", () => {
    const read = toReadBlocks([
      { type: "heading", level: 2, text: "Plan" },
      { type: "paragraph", text: "The first sentence is here. The second one follows it." },
    ]);
    assert.equal(read[0].sentences[0].pauseAfter, PAUSES.heading);
    assert.deepEqual(
      read[1].sentences.map((s) => s.pauseAfter),
      [PAUSES.sentence, PAUSES.paragraph]
    );
  });

  it("keeps the very first spoken chunk short so audio starts quickly", () => {
    const long = `${"alpha beta gamma, ".repeat(15).trim()}.`;
    const [first, second] = toReadBlocks([
      { type: "paragraph", text: long },
      { type: "paragraph", text: long },
    ]);
    assert.ok(first.sentences[0].display.length <= LIMITS.firstMaxChars);
    assert.ok(second.sentences[0].display.length > LIMITS.firstMaxChars);
  });

  it("drops blocks with nothing to say", () => {
    assert.deepEqual(toReadBlocks([{ type: "paragraph", text: "**" }]), []);
  });
});

describe("preferHtml", () => {
  it("uses HTML with document structure", () => {
    assert.equal(preferHtml("<h2>Plan</h2><p>Text</p>"), true);
  });

  it("falls back to plain text for code-editor HTML", () => {
    assert.equal(preferHtml('<div><span style="color:red"># Title</span></div>'), false);
  });
});
