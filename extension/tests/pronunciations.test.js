import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_PRONUNCIATIONS,
  applyPronunciations,
  parsePronunciations,
  speechFor,
  toReadBlocks,
} from "../src/text.js";

const defaults = parsePronunciations(DEFAULT_PRONUNCIATIONS);

describe("parsePronunciations", () => {
  it("reads written = spoken lines and skips comments and junk", () => {
    assert.deepEqual(parsePronunciations("# note\n\nfoo = bar\n = nothing\nno equals\nK-1s = K-ones\n"), [
      { from: "K-1s", to: "K-ones" },
      { from: "foo", to: "bar" },
    ]);
  });

  it("parses the defaults", () => {
    assert.ok(defaults.some((r) => r.from === "uat" && r.to === "you-eh-tee"));
  });
});

describe("applyPronunciations", () => {
  it("replaces lowercase uat, including inside hyphenated names", () => {
    assert.equal(
      applyPronunciations("Deploy aggregator-uat to uat, then (uat).", defaults),
      "Deploy aggregator-you-eh-tee to you-eh-tee, then (you-eh-tee)."
    );
  });

  it("matches whole words only", () => {
    assert.equal(applyPronunciations("evaluation quatro UATs", defaults), "evaluation quatro UATs");
  });

  it("is case-sensitive", () => {
    assert.equal(applyPronunciations("Uat", defaults), "Uat");
  });

  it("escapes regex characters in the written form", () => {
    assert.equal(applyPronunciations("Use C++ and C.", [{ from: "C++", to: "C plus plus" }]), "Use C plus plus and C.");
  });
});

describe("pronunciations in speech", () => {
  it("apply before identifier splitting", () => {
    assert.equal(speechFor("Load my_uat_table.", [{ from: "my_uat_table", to: "the table" }]), "Load the table.");
  });

  it("change what's spoken but not what's shown", () => {
    const [read] = toReadBlocks([{ type: "paragraph", text: "We deploy to uat every day." }], {
      pronunciations: defaults,
    });
    assert.equal(read.sentences[0].display, "We deploy to uat every day.");
    assert.equal(read.sentences[0].speech, "We deploy to you-eh-tee every day.");
  });
});
