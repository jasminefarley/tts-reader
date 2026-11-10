import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { chooseContent } from "../src/extract.js";

/** @param {Partial<import("../src/extract.js").FrameContent>} f */
const frame = (f) => ({
  isTop: false,
  url: "https://example.com/",
  title: "",
  articleHtml: null,
  articleTitle: null,
  articleChars: 0,
  bodyHtml: "<p>body</p>",
  bodyChars: 0,
  frameOrigins: [],
  ...f,
});

describe("chooseContent", () => {
  it("reads the article Readability found on a normal page", () => {
    const result = chooseContent([
      frame({ isTop: true, title: "Site | Post", articleHtml: "<p>article</p>", articleTitle: "Post", articleChars: 5000, bodyChars: 9000 }),
    ]);
    assert.deepEqual(result, { ok: true, html: "<p>article</p>", title: "Post" });
  });

  it("reads the artifact frame on claude.ai, not the chat around it", () => {
    const result = chooseContent([
      frame({ isTop: true, url: "https://claude.ai/chat/1", title: "Chat", articleHtml: "<p>chat</p>", articleChars: 8000, bodyChars: 9000, frameOrigins: ["https://www.claudeusercontent.com"] }),
      frame({ url: "https://www.claudeusercontent.com/x", title: "Plan", bodyHtml: "<h1>Plan</h1>", bodyChars: 4000 }),
      frame({ url: "https://www.claudeusercontent.com/y", bodyHtml: "<p>tiny</p>", bodyChars: 50 }),
    ]);
    assert.deepEqual(result, { ok: true, html: "<h1>Plan</h1>", title: "Plan" });
  });

  it("asks for access when the artifact frame couldn't be read", () => {
    const result = chooseContent([
      frame({ isTop: true, url: "https://claude.ai/artifact/abc", bodyChars: 100, frameOrigins: ["https://www.claudeusercontent.com", "https://js.stripe.com"] }),
    ]);
    assert.deepEqual(result, { ok: false, blockedOrigins: ["https://www.claudeusercontent.com"] });
  });

  it("falls back to the article on claude.ai pages without an artifact", () => {
    const result = chooseContent([
      frame({ isTop: true, url: "https://claude.ai/chat/1", articleHtml: "<p>chat</p>", articleTitle: "Chat", articleChars: 3000, frameOrigins: ["https://js.stripe.com"] }),
    ]);
    assert.deepEqual(result, { ok: true, html: "<p>chat</p>", title: "Chat" });
  });

  it("falls back to the largest frame when Readability finds nothing", () => {
    const result = chooseContent([
      frame({ isTop: true, title: "App", bodyHtml: "<div>nav</div>", bodyChars: 300 }),
      frame({ bodyHtml: "<div>main</div>", bodyChars: 2000, title: "" }),
    ]);
    assert.deepEqual(result, { ok: true, html: "<div>main</div>", title: "App" });
  });

  it("reports when there is nothing to read", () => {
    const result = chooseContent([frame({ isTop: true, bodyChars: 10 })]);
    assert.equal(result.ok, false);
    assert.ok("error" in result);
  });
});
