import { describe, expect, it } from "bun:test";
import { aggregateSourceMaterial, buildSourceMaterial } from "@/lib/classmate-source";

describe("aggregateSourceMaterial", () => {
  it("returns an empty string for no files", () => {
    expect(aggregateSourceMaterial([])).toBe("");
  });

  it("passes a single file through verbatim", () => {
    const text = "Section I: Multiple Choice\n1. What is 7 × 8?";
    expect(aggregateSourceMaterial([{ name: "lecture.pdf", size: 100, text }])).toBe(text);
  });

  it("labels and separates multiple files", () => {
    const out = aggregateSourceMaterial([
      { name: "slides.pdf", size: 10, text: "  Slide content  " },
      { name: "handout.docx", size: 20, text: "Handout content" },
    ]);
    expect(out).toContain("--- SOURCE MATERIAL 1: slides.pdf ---");
    expect(out).toContain("--- SOURCE MATERIAL 2: handout.docx ---");
    expect(out).toContain("Slide content");
    expect(out).toContain("Handout content");
    // Files are separated by a blank line, order preserved.
    expect(out.indexOf("slides.pdf")).toBeLessThan(out.indexOf("handout.docx"));
    expect(out).toContain("---\nSlide content\n\n---");
  });

  it("trims each file's text", () => {
    const out = aggregateSourceMaterial([
      { name: "a.txt", size: 1, text: "\n\nA\n\n" },
      { name: "b.txt", size: 1, text: "\tB\t" },
    ]);
    expect(out).toContain("--- SOURCE MATERIAL 1: a.txt ---\nA");
    expect(out).toContain("--- SOURCE MATERIAL 2: b.txt ---\nB");
  });
});

describe("buildSourceMaterial", () => {
  it("returns an empty payload when there are no usable files", () => {
    const built = buildSourceMaterial([
      { name: "blank.pdf", size: 1, text: "   " },
      { name: "empty.txt", size: 0, text: "" },
    ]);
    expect(built.text).toBe("");
    expect(built.files).toEqual([]);
  });

  it("passes a single small file through verbatim", () => {
    const built = buildSourceMaterial([{ name: "a.txt", size: 1, text: "hello" }]);
    expect(built.text).toBe("hello");
    expect(built.truncated).toBe(false);
    expect(built.files[0]).toMatchObject({ name: "a.txt", truncated: false });
  });

  it("includes EVERY file even when the total exceeds the budget", () => {
    // Four files, each far larger than its share of a tiny budget.
    const files = [1, 2, 3, 4].map((n) => ({
      name: `week${n}.pdf`,
      size: 1000,
      text: `FILE-${n}-MARKER ` + "x".repeat(5000),
    }));
    const built = buildSourceMaterial(files, 2000);

    // All four headers must be present so the model never under-counts.
    for (const n of [1, 2, 3, 4]) {
      expect(built.text).toContain(`--- SOURCE MATERIAL ${n}: week${n}.pdf ---`);
    }
    expect(built.files).toHaveLength(4);
    expect(built.truncated).toBe(true);
    // Budget is respected (with a little slack for the truncation markers).
    expect(built.totalChars).toBeLessThan(4000);
  });

  it("reports per-file truncation metadata", () => {
    const built = buildSourceMaterial(
      [
        { name: "small.txt", size: 1, text: "short" },
        { name: "big.txt", size: 1, text: "y".repeat(10_000) },
      ],
      4000,
    );
    const big = built.files.find((f) => f.name === "big.txt")!;
    expect(big.truncated).toBe(true);
    expect(big.includedChars).toBeLessThan(big.chars);
    const small = built.files.find((f) => f.name === "small.txt")!;
    expect(small.truncated).toBe(false);
  });

  it("marks a single oversized file as truncated", () => {
    const built = buildSourceMaterial([{ name: "big.txt", size: 1, text: "z".repeat(5000) }], 1000);
    expect(built.truncated).toBe(true);
    expect(built.text).toContain("[truncated");
  });
});
