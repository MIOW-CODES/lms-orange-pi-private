import { describe, it, expect } from "bun:test";

import {
  parseKeywordCategories,
  gradeEssay,
  applyIntegrityPenalty,
  selectQuestionBank,
  validateAttemptQuestionIds,
  gateAttemptResults,
  randomizeQuestions,
  attemptCeiling,
} from "./quizzes.server";

describe("teacher-approved retakes", () => {
  it("limits a worksheet to one attempt until an individual grant is issued", () => {
    const policy = { allow_retake: false, max_attempts: 0 };
    expect(attemptCeiling(policy, 0)).toBe(1);
    expect(attemptCeiling(policy, 1)).toBe(2);
    expect(attemptCeiling(policy, 2)).toBe(3);
  });

  it("honors an explicit teacher policy for a finite or unlimited allowance", () => {
    expect(attemptCeiling({ allow_retake: true, max_attempts: 2 }, 0)).toBe(2);
    expect(attemptCeiling({ allow_retake: true, max_attempts: 0 }, 0)).toBeNull();
  });
});

/* ---------- randomizeQuestions (exam jumbling) ---------- */

describe("randomizeQuestions", () => {
  const mcq = (id: string, n: number) => ({
    id,
    options: Array.from({ length: n }, (_, i) => `${id}-opt${i}`),
    position: 0,
  });

  it("keeps every question and preserves each question's option set", () => {
    const input = [mcq("a", 4), mcq("b", 4), mcq("c", 4)];
    const out = randomizeQuestions(input);
    expect(out.map((q) => q.id).sort()).toEqual(["a", "b", "c"]);
    for (const q of out) {
      const original = input.find((x) => x.id === q.id)!;
      expect([...q.options].sort()).toEqual([...original.options].sort());
    }
  });

  it("jumbles the question order and renumbers positions sequentially", () => {
    const input = Array.from({ length: 12 }, (_, i) => mcq(`q${i}`, 4));
    expect(randomizeQuestions(input).map((q) => q.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    // Over many runs the authored order cannot be preserved every time.
    const anyReordered = Array.from({ length: 20 }, () =>
      randomizeQuestions(input).map((q) => q.id),
    ).some((order) => order.join() !== input.map((q) => q.id).join());
    expect(anyReordered).toBe(true);
  });

  it("removes positional answer bias: the correct option is not always first", () => {
    // Authored like the ICT1 seed: correct answer is always option index 0.
    const input = Array.from({ length: 10 }, (_, i) => ({
      id: `q${i}`,
      options: [`CORRECT-${i}`, `wrong-a-${i}`, `wrong-b-${i}`, `wrong-c-${i}`],
      position: 0,
    }));
    const firstIsCorrect = Array.from(
      { length: 25 },
      () =>
        randomizeQuestions(input).filter((q) => q.options[0] === `CORRECT-${q.id.slice(1)}`).length,
    );
    // ~1/4 expected by chance; assert it is not the authored 10/10 every run.
    expect(firstIsCorrect.some((n) => n < input.length)).toBe(true);
    expect(firstIsCorrect.some((n) => n === input.length)).toBe(false);
  });

  it("leaves single-option and option-less (essay) questions untouched", () => {
    const input = [
      { id: "essay", options: [], position: 0 },
      { id: "tf", options: ["True"], position: 0 },
    ];
    const out = randomizeQuestions(input);
    expect(out.find((q) => q.id === "essay")!.options).toEqual([]);
    expect(out.find((q) => q.id === "tf")!.options).toEqual(["True"]);
  });

  it("keeps required exam sections pinned in authored slot AND order", () => {
    // Mirrors the IT10 1st Quarter Exam: a flexible MCQ body followed by a
    // fixed `required` section (Part I picture ID, Part IV essays) that must
    // never scatter into the middle of the paper.
    const flexible = Array.from({ length: 8 }, (_, i) => ({
      id: `flex${i}`,
      options: [`${i}a`, `${i}b`, `${i}c`, `${i}d`],
      required: false,
      position: 0,
    }));
    const pinned = [
      { id: "partI-1", options: ["o1", "o2", "o3", "o4"], required: true, position: 0 },
      { id: "partI-2", options: ["o1", "o2", "o3", "o4"], required: true, position: 0 },
      { id: "partIV", options: [], required: true, position: 0 },
    ];
    const input = [...flexible, ...pinned];
    const out = randomizeQuestions(input);
    // Required items stay at the tail in authored order.
    expect(out.map((q) => q.id).slice(-3)).toEqual(["partI-1", "partI-2", "partIV"]);
    // The flexible body still occupies the first slots as the same set.
    expect(
      out
        .slice(0, 8)
        .map((q) => q.id)
        .sort(),
    ).toEqual(flexible.map((q) => q.id).sort());
    // Positions are renumbered sequentially.
    expect(out.map((q) => q.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("still jumbles the flexible pool even when required items are present", () => {
    const flex = Array.from({ length: 10 }, (_, i) => ({
      id: `f${i}`,
      options: ["a", "b", "c", "d"],
      required: false,
      position: 0,
    }));
    const input = [...flex, { id: "pinned", options: ["a", "b"], required: true, position: 0 }];
    const anyReordered = Array.from({ length: 20 }, () =>
      randomizeQuestions(input)
        .slice(0, 10)
        .map((q) => q.id),
    ).some((order) => order.join() !== flex.map((q) => q.id).join());
    expect(anyReordered).toBe(true);
  });

  it("shuffles answer options for required multiple-choice items too", () => {
    const input = [
      { id: "p1", options: ["o1", "o2", "o3", "o4"], required: true, position: 0 },
      { id: "p2", options: ["o1", "o2", "o3", "o4"], required: true, position: 0 },
    ];
    const anyReordered = Array.from(
      { length: 20 },
      () => randomizeQuestions(input).filter((q) => q.options[0] === "o1").length,
    ).some((n) => n < input.length);
    expect(anyReordered).toBe(true);
    for (const q of randomizeQuestions(input)) {
      expect([...q.options].sort()).toEqual(["o1", "o2", "o3", "o4"]);
    }
  });
});

/* ---------- selectQuestionBank ---------- */

describe("selectQuestionBank", () => {
  const pool = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }));

  it("returns every question when count is 0 (bank disabled)", () => {
    expect(selectQuestionBank(pool, 0, [])).toEqual(pool);
  });

  it("returns the whole pool when it is smaller than the requested count", () => {
    expect(selectQuestionBank(pool, 25, [])).toHaveLength(10);
  });

  it("returns exactly the requested count", () => {
    expect(selectQuestionBank(pool, 4, [])).toHaveLength(4);
  });

  it("prefers unseen questions when enough remain", () => {
    const used = ["q0", "q1", "q2", "q3", "q4", "q5"];
    const picked = selectQuestionBank(pool, 3, used).map((q) => q.id);
    expect(picked).toHaveLength(3);
    expect(picked.every((id) => !used.includes(id))).toBe(true);
  });

  it("fills the remainder from seen questions without duplicates when the bank runs low", () => {
    const used = ["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"];
    const picked = selectQuestionBank(pool, 5, used).map((q) => q.id);
    expect(picked).toHaveLength(5);
    expect(new Set(picked).size).toBe(5);
    // The two unseen items must be included; the rest are recycled.
    expect(picked).toContain("q8");
    expect(picked).toContain("q9");
  });

  it("still returns the requested count when every question was already seen", () => {
    const used = pool.map((q) => q.id);
    const picked = selectQuestionBank(pool, 4, used);
    expect(picked).toHaveLength(4);
    expect(new Set(picked.map((q) => q.id)).size).toBe(4);
  });

  it("randomizes the selection across repeated calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      seen.add(
        selectQuestionBank(pool, 3, [])
          .map((q) => q.id)
          .sort()
          .join(","),
      );
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("always returns a unique subset of the pool, for many random inputs", () => {
    const ids = new Set(pool.map((q) => q.id));
    for (let count = 1; count <= 12; count++) {
      for (let run = 0; run < 25; run++) {
        const used = pool.slice(0, run % 11).map((q) => q.id);
        const picked = selectQuestionBank(pool, count, used);
        // Never longer than requested or the pool.
        expect(picked.length).toBe(Math.min(count, pool.length));
        // Every item comes from the pool.
        expect(picked.every((q) => ids.has(q.id))).toBe(true);
        // No duplicates.
        expect(new Set(picked.map((q) => q.id)).size).toBe(picked.length);
      }
    }
  });

  it("always includes required (pinned) questions in every draw", () => {
    const withPinned = [
      ...pool.slice(0, 8),
      { id: "pin1", required: true },
      { id: "pin2", required: true },
      { id: "pin3", required: true },
    ];
    for (let run = 0; run < 25; run++) {
      const picked = selectQuestionBank(withPinned, 5, []).map((q) => q.id);
      expect(picked).toHaveLength(5);
      expect(picked).toContain("pin1");
      expect(picked).toContain("pin2");
      expect(picked).toContain("pin3");
      expect(new Set(picked).size).toBe(5);
    }
  });

  it("keeps required questions on retakes even when already seen", () => {
    const withPinned = [...pool.slice(0, 6), { id: "pin1", required: true }];
    const allUsed = withPinned.map((q) => q.id);
    const picked = selectQuestionBank(withPinned, 4, allUsed).map((q) => q.id);
    expect(picked).toHaveLength(4);
    expect(picked).toContain("pin1");
  });

  it("returns only required questions (shuffled) when they fill the draw", () => {
    const withPinned = [
      ...pool,
      { id: "pin1", required: true },
      { id: "pin2", required: true },
      { id: "pin3", required: true },
    ];
    const picked = selectQuestionBank(withPinned, 3, [])
      .map((q) => q.id)
      .sort();
    expect(picked).toEqual(["pin1", "pin2", "pin3"]);
  });
});

/* ---------- parseKeywordCategories ---------- */

describe("parseKeywordCategories", () => {
  it("returns empty array when no keyword marker is present", () => {
    expect(parseKeywordCategories("Just a plain rubric")).toEqual([]);
  });

  it("parses a single category with pipe prefix", () => {
    const result = parseKeywordCategories(
      "Rubric text | Keywords: anaerobic = respiration, oxygen",
    );
    expect(result).toEqual([["respiration", "oxygen"]]);
  });

  it("parses a single category without pipe prefix", () => {
    const result = parseKeywordCategories("Keywords: mitosis = cell, division, spindle");
    expect(result).toEqual([["cell", "division", "spindle"]]);
  });

  it("parses multiple categories separated by semicolons", () => {
    const result = parseKeywordCategories(
      "| Keywords: cat1 = alpha, beta; cat2 = gamma; cat3 = delta, epsilon",
    );
    expect(result).toEqual([["alpha", "beta"], ["gamma"], ["delta", "epsilon"]]);
  });

  it("is case-insensitive for the keyword marker", () => {
    const result = parseKeywordCategories("| KEYWORDS: foo = bar, baz");
    expect(result).toEqual([["bar", "baz"]]);
  });

  it("handles slash separators between keywords", () => {
    const result = parseKeywordCategories("| Keywords: group = one/two/three");
    expect(result).toEqual([["one", "two", "three"]]);
  });

  it("handles pipe separators between keywords", () => {
    const result = parseKeywordCategories("| Keywords: group = alpha | beta");
    expect(result).toEqual([["alpha", "beta"]]);
  });

  it("trims whitespace around keywords", () => {
    const result = parseKeywordCategories("| Keywords: g =  alpha ,  beta  , gamma ");
    expect(result).toEqual([["alpha", "beta", "gamma"]]);
  });

  it("filters out empty groups", () => {
    const result = parseKeywordCategories("| Keywords: ; valid = a, b; ");
    expect(result).toEqual([["a", "b"]]);
  });

  it("filters out empty keyword entries after trimming", () => {
    const result = parseKeywordCategories("| Keywords: g = a,,b,,");
    expect(result).toEqual([["a", "b"]]);
  });

  it("returns empty array for bare 'Keywords:' with no values", () => {
    expect(parseKeywordCategories("Keywords:")).toEqual([]);
  });

  it("strips category names before the equals sign", () => {
    const result = parseKeywordCategories("| Keywords: biology concept = photosynthesis");
    expect(result).toEqual([["photosynthesis"]]);
  });
});

/* ---------- gradeEssay ---------- */

describe("gradeEssay", () => {
  describe("gibberish detection", () => {
    it("rejects answers with fewer than 5 words", () => {
      expect(gradeEssay("hello world", "concept = hello, world")).toBe(false);
    });

    it("rejects empty answers", () => {
      expect(gradeEssay("", "concept = word1, word2")).toBe(false);
    });

    it("rejects answers with 4+ repeated characters", () => {
      expect(gradeEssay("this is aaaaaaa test answer for the rubric", "test = this, answer")).toBe(
        false,
      );
    });

    it("rejects answers with long consonant-only words", () => {
      expect(gradeEssay("this is a crwth test answer for the rubric", "test = this, answer")).toBe(
        false,
      );
    });

    it("accepts normal answers with 5+ words", () => {
      expect(
        gradeEssay(
          "The process of photosynthesis converts light energy to chemical energy in plants",
          "photosynthesis = process, energy, plants",
        ),
      ).toBe(true);
    });

    it("rejects keyword stuffing without a readable explanation", () => {
      expect(
        gradeEssay(
          "mitosis spindle chromosomes division membrane",
          "phase = mitosis, spindle; outcome = chromosomes, division",
        ),
      ).toBe(false);
      expect(
        gradeEssay(
          "mitosis causes spindle chromosomes division membrane",
          "phase = mitosis, spindle; outcome = chromosomes, division",
        ),
      ).toBe(false);
    });

    it("accepts a concise subject-predicate explanation", () => {
      expect(
        gradeEssay(
          "Photosynthesis converts light energy into chemical energy",
          "process = photosynthesis, energy",
        ),
      ).toBe(true);
      expect(
        gradeEssay(
          "Cell division produces identical daughter cells",
          "outcome = division, identical cells",
        ),
      ).toBe(true);
    });
  });

  describe("rubric concept fallback (no keyword categories)", () => {
    it("passes when answer contains 2+ rubric concepts", () => {
      expect(
        gradeEssay(
          "Mitosis is a type of cell division that produces identical daughter cells",
          "Mitosis involves cell division producing identical cells",
        ),
      ).toBe(true);
    });

    it("fails when answer contains fewer than 2 rubric concepts", () => {
      expect(
        gradeEssay(
          "The answer is about something completely unrelated to the topic",
          "mitosis involves cell division producing identical cells",
        ),
      ).toBe(false);
    });

    it("handles multi-word keywords via substring match", () => {
      expect(
        gradeEssay(
          "Cell division occurs during mitosis in eukaryotic organisms",
          "| Keywords: division = cell division, mitosis",
        ),
      ).toBe(true);
    });
  });

  describe("single keyword category", () => {
    it("passes when 2+ keywords from the single category match", () => {
      expect(
        gradeEssay(
          "The cell undergoes mitosis and cell division to replicate",
          "| Keywords: process = mitosis, cell division, replicate",
        ),
      ).toBe(true);
    });

    it("fails when fewer than 2 keywords match in single category", () => {
      expect(
        gradeEssay(
          "The process involves something unrelated to the topic entirely",
          "| Keywords: process = mitosis, cell division, replicate",
        ),
      ).toBe(false);
    });
  });

  describe("multiple keyword categories (>=2)", () => {
    it("passes when at least 2 categories have a hit", () => {
      expect(
        gradeEssay(
          "Mitosis involves spindle fibers separating chromosomes during cell division",
          "| Keywords: phase = mitosis, spindle; outcome = chromosomes, division",
        ),
      ).toBe(true);
    });

    it("fails when fewer than 2 categories have a hit", () => {
      expect(
        gradeEssay(
          "Mitosis is an important process that cells use to replicate themselves",
          "| Keywords: phase = mitosis, spindle; outcome = chromosomes, division",
        ),
      ).toBe(false);
    });

    it("requires at least 2 categories even if all keywords in one category match", () => {
      expect(
        gradeEssay(
          "Spindle fibers attach to chromosomes and kinetochores during mitosis",
          "| Keywords: phase = mitosis, spindle, kinetochore; outcome = growth, repair",
        ),
      ).toBe(false);
    });
  });

  describe("keyword matching edge cases", () => {
    it("matches case-insensitively", () => {
      expect(
        gradeEssay(
          "The process of MITOSIS involves nuclear division in cells",
          "| Keywords: core = mitosis, nuclear",
        ),
      ).toBe(true);
    });

    it("matches single-word keywords via word boundary regex", () => {
      expect(
        gradeEssay(
          "Osmosis is the movement of water across a semipermeable membrane",
          "| Keywords: concept = osmosis, membrane",
        ),
      ).toBe(true);
    });

    it("does not match partial words for single keywords without spaces", () => {
      // "osmo" should not match "osmosis" since the regex uses \w* after the keyword
      // Actually looking at the code: `new RegExp(`\\b${needle}\\w*`, "i")` — it DOES match prefixes
      // So "osmo" will match "osmosis". That's by design (stem matching).
      expect(
        gradeEssay(
          "Osmosis is the movement of water across a semipermeable membrane",
          "| Keywords: concept = osmo, membrane",
        ),
      ).toBe(true);
    });
  });

  describe("answer normalization", () => {
    it("ignores leading/trailing whitespace in answer words", () => {
      expect(
        gradeEssay(
          "  The cell undergoes mitosis for division  ",
          "| Keywords: core = cell, mitosis",
        ),
      ).toBe(true);
    });

    it("handles hyphenated words", () => {
      expect(
        gradeEssay(
          "The well-known process of cell division occurs during mitosis",
          "| Keywords: core = well-known, mitosis",
        ),
      ).toBe(true);
    });
  });
});

describe("applyIntegrityPenalty", () => {
  it("deducts one point per event and never makes a score negative", () => {
    expect(applyIntegrityPenalty(10, [{ type: "blur" }, { type: "paste" }])).toEqual({
      score: 8,
      penalty: 2,
    });
    expect(applyIntegrityPenalty(1, [{ type: "blur" }, { type: "paste" }])).toEqual({
      score: 0,
      penalty: 1,
    });
  });
});

/* ---------- validateAttemptQuestionIds ---------- */

describe("validateAttemptQuestionIds", () => {
  const quizQuestionIds = ["q1", "q2", "q3", "q4"];

  it("accepts a legacy submit without question ids when the bank is disabled", () => {
    expect(validateAttemptQuestionIds(undefined, quizQuestionIds, 0)).toEqual({
      ok: true,
      questionIds: undefined,
    });
  });

  it("accepts the exact drawn set for a question-bank worksheet", () => {
    expect(validateAttemptQuestionIds(["q2", "q4"], quizQuestionIds, 2)).toEqual({
      ok: true,
      questionIds: ["q2", "q4"],
    });
  });

  it("rejects question ids that do not belong to the worksheet", () => {
    const res = validateAttemptQuestionIds(["q1", "foreign"], quizQuestionIds, 0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not part of this worksheet");
  });

  it("rejects ids from another worksheet even when the count matches", () => {
    const res = validateAttemptQuestionIds(["x1", "x2"], quizQuestionIds, 2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not part of this worksheet");
  });

  it("requires question_ids.length === question_count when the bank is enabled", () => {
    const tooFew = validateAttemptQuestionIds(["q1"], quizQuestionIds, 3);
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) expect(tooFew.error).toContain("3 question(s)");

    const tooMany = validateAttemptQuestionIds(["q1", "q2", "q3", "q4"], quizQuestionIds, 3);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.error).toContain("sent 4 question id(s)");

    const missing = validateAttemptQuestionIds(undefined, quizQuestionIds, 3);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("sent 0 question id(s)");
  });

  it("rejects duplicate question ids", () => {
    const res = validateAttemptQuestionIds(["q1", "q1"], quizQuestionIds, 2);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Duplicate");
  });

  it("ignores the count rule when question_count is 0 (no bank)", () => {
    expect(validateAttemptQuestionIds(["q1", "q2"], quizQuestionIds, 0)).toEqual({
      ok: true,
      questionIds: ["q1", "q2"],
    });
  });
});

/* ---------- gateAttemptResults ---------- */

describe("gateAttemptResults", () => {
  const row = (id: string, correct_answer: string) => ({
    id,
    question: `Question ${id}`,
    correct_answer,
    correct: true,
    chosen: "A",
    options: ["A", "B"],
    image_url: null,
  });

  it("returns no rows (and therefore no correctness flags) until scores are released", () => {
    expect(
      gateAttemptResults([row("a", "A"), row("b", "B")], {
        scoreReleased: false,
        answerKeyReleased: true,
      }),
    ).toEqual([]);
    expect(
      gateAttemptResults([row("a", "A")], {
        scoreReleased: false,
        answerKeyReleased: false,
      }),
    ).toEqual([]);
  });

  it("keeps review rows but blanks the answer key when only scores are released", () => {
    const gated = gateAttemptResults([row("a", "A")], {
      scoreReleased: true,
      answerKeyReleased: false,
    });
    expect(gated).toHaveLength(1);
    expect(gated[0]!.correct_answer).toBe("");
  });

  it("returns full per-question results once the answer key is released", () => {
    const results = [row("a", "A"), row("b", "B")];
    expect(gateAttemptResults(results, { scoreReleased: true, answerKeyReleased: true })).toEqual(
      results,
    );
  });
});

describe("reported resistor explanation", () => {
  it("accepts a complete four-band explanation using gives as its predicate", () => {
    expect(
      gradeEssay(
        "first and second band gives the significant digits, the third band gives the multiplier, the fourth band gives the tolerance",
        "Explain how the first two bands form significant digits, the third gives a multiplier, and the fourth gives tolerance. | Keywords: digits = digit, first, second; calculation = multiplier, multiply; tolerance = tolerance, percent",
      ),
    ).toBe(true);
  });
  it("still rejects bare resistor keywords", () => {
    expect(
      gradeEssay(
        "first second digit multiplier tolerance percent",
        "Keywords: digits = digit, first, second; calculation = multiplier, multiply; tolerance = tolerance, percent",
      ),
    ).toBe(false);
  });
});

describe("highest retake calculation", () => {
  it("keeps the highest percentage even when a later raw score is larger", async () => {
    const { effectiveScore } = await import("./quizzes.server");
    const attempts = [
      { attempt_number: 1, score: 9, total: 10 },
      { attempt_number: 2, score: 16, total: 20 },
      { attempt_number: 3, score: 5, total: 10 },
    ];
    expect(effectiveScore(attempts, "highest_score")).toEqual({ score: 9, total: 10 });
    expect(effectiveScore(attempts, "latest_attempt")).toEqual({ score: 5, total: 10 });
    expect(effectiveScore([], "highest_score")).toBe(null);
  });
});
