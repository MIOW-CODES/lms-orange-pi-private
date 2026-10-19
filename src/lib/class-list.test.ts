import { describe, expect, it } from "bun:test";
import {
  mergeSplitName,
  parseClassList,
  parseGradeCell,
  reviewClassList,
  splitFields,
} from "./class-list";

describe("parseGradeCell", () => {
  it("keeps grade levels 7–16 as-is", () => {
    expect(parseGradeCell("10").value).toBe(10);
    expect(parseGradeCell("Grade 10").value).toBe(10);
    expect(parseGradeCell("G11").value).toBe(11);
    expect(parseGradeCell("11 STEM").value).toBe(11);
    expect(parseGradeCell("12").value).toBe(12);
  });

  it("maps college years onto 13–16", () => {
    expect(parseGradeCell("3").value).toBe(15);
    expect(parseGradeCell("3rd Year").value).toBe(15);
    expect(parseGradeCell("Year 1").value).toBe(13);
    expect(parseGradeCell("First Year").value).toBe(13);
    expect(parseGradeCell("4").value).toBe(16);
  });

  it("never maps an explicit grade below 7 onto college year", () => {
    expect(parseGradeCell("grade 3").value).toBeNull();
    expect(parseGradeCell("2024").value).toBeNull();
    expect(parseGradeCell("omega").value).toBeNull();
    expect(parseGradeCell("").value).toBeNull();
  });
});

describe("splitFields / mergeSplitName", () => {
  it("splits quoted CSV names that contain commas", () => {
    expect(splitFields('2024-2699,"ACOSTA, Axel Rose V.",F,3', "comma")).toEqual([
      "2024-2699",
      "ACOSTA, Axel Rose V.",
      "F",
      "3",
    ]);
  });

  it("re-joins unquoted 'LAST, First' names that comma-splitting tore apart", () => {
    expect(mergeSplitName(["2024-2699", "ACOSTA", "Axel Rose V.", "F", "3"], 4)).toEqual([
      "2024-2699",
      "ACOSTA, Axel Rose V.",
      "F",
      "3",
    ]);
  });

  it("keeps tab-separated rows intact", () => {
    expect(splitFields("2024-2699\tACOSTA, Axel Rose V.\tF\t3", "tab")).toEqual([
      "2024-2699",
      "ACOSTA, Axel Rose V.",
      "F",
      "3",
    ]);
  });
});

describe("parseClassList", () => {
  it("parses a TSV paste with a header row (the ICT1 class-list shape)", () => {
    const text = [
      "Student ID\tName\tGender\tYear",
      "2024-2699\tACOSTA, Axel Rose V.\tF\t3",
      "2024-2712\tAMEROL, Jenan M.\tF\t3",
      "2023-1550\tBUSANO, JOHN DALE S.\tM\t4",
    ].join("\n");
    const out = parseClassList(text);
    expect(out.hasHeader).toBe(true);
    expect(out.delimiter).toBe("tab");
    expect(out.rows).toHaveLength(3);
    expect(out.rows[0]).toMatchObject({
      student_id: "2024-2699",
      full_name: "ACOSTA, Axel Rose V.",
      grade_level: 15,
      errors: [],
    });
    expect(out.rows[2]).toMatchObject({ student_id: "2023-1550", grade_level: 16 });
    expect(out.notes.some((n) => n.includes("gender"))).toBe(true);
  });

  it("parses header-less CSV with gender and year columns", () => {
    const text = [
      "2024-2699,ACOSTA Axel Rose V.,F,3",
      "2024-2712,AMEROL Jenan M.,F,3",
      "2023-1550,BUSANO JOHN DALE S.,M,4",
      "2024-2017,APOG Nipo Cyrus T.,M,3",
    ].join("\n");
    const out = parseClassList(text);
    expect(out.hasHeader).toBe(false);
    expect(out.rows[0]).toMatchObject({
      student_id: "2024-2699",
      full_name: "ACOSTA Axel Rose V.",
      grade_level: 15,
    });
    expect(out.rows[3]?.grade_level).toBe(15);
  });

  it("re-joins unquoted 'LAST, First' names even when every row splits evenly", () => {
    const text = [
      "2024-2699,ACOSTA, Axel Rose V.,F,3",
      "2024-2712,AMEROL, Jenan M.,F,3",
      "2023-1550,BUSANO, JOHN DALE S.,M,4",
      "2024-2017,APOG, Nipo Cyrus T.,M,3",
    ].join("\n");
    const out = parseClassList(text);
    expect(out.rows).toHaveLength(4);
    expect(out.rows[0]).toMatchObject({
      student_id: "2024-2699",
      full_name: "ACOSTA, Axel Rose V.",
      grade_level: 15,
    });
    expect(out.rows[2]).toMatchObject({
      student_id: "2023-1550",
      full_name: "BUSANO, JOHN DALE S.",
      grade_level: 16,
    });
    expect(out.rows[0]?.gender).toBe("F");
  });

  it("handles space-aligned rows pasted from a PDF", () => {
    const text = [
      "2024-2699   ACOSTA, Axel Rose V.   F   3",
      "2024-2712   AMEROL, Jenan M.   F   3",
      "2023-1550   BUSANO, JOHN DALE S.   M   4",
      "2024-2017   APOG, Nipo Cyrus T.   M   3",
    ].join("\n");
    const out = parseClassList(text);
    expect(out.delimiter).toBe("spaces");
    expect(out.rows).toHaveLength(4);
    expect(out.rows[1]).toMatchObject({
      student_id: "2024-2712",
      full_name: "AMEROL, Jenan M.",
      grade_level: 15,
    });
  });

  it("composes names from Last / First / Middle columns", () => {
    const text = [
      "Student No,Last Name,First Name,Middle,Year Level,Section",
      "2026-0042,Dela Cruz,Juan,Miguel,10,Omega",
      "2026-0043,Santos,Maria Clara,Lopez,10,Omega",
    ].join("\n");
    const out = parseClassList(text);
    expect(out.rows[0]).toMatchObject({
      student_id: "2026-0042",
      full_name: "Dela Cruz, Juan Miguel",
      grade_level: 10,
      section: "Omega",
    });
    expect(out.rows[1]?.full_name).toBe("Santos, Maria Clara Lopez");
  });

  it("maps a program column onto section", () => {
    const text = [
      "student_id,name,gender,college_year,program",
      "2024-2699,ACOSTA Axel Rose V.,F,3,BTLED-IA",
      "2024-2712,AMEROL Jenan M.,F,3,BTLED-IA",
    ].join("\n");
    const out = parseClassList(text);
    expect(out.rows[0]).toMatchObject({ section: "BTLED-IA", grade_level: 15 });
  });

  it("flags broken rows without dropping them", () => {
    const text = [
      "student_id,name,gender,year",
      "2026-0042,,F,10",
      ",NO NUMBER HERE,F,10",
      "2026-0044,Ok Student,F,zzz",
    ].join("\n");
    const out = parseClassList(text);
    expect(out.rows[0]?.errors.join()).toContain("name");
    expect(out.rows[1]?.errors.join()).toContain("student number");
    expect(out.rows[2]?.errors).toEqual([]);
    expect(out.rows[2]?.grade_level).toBeNull();
    expect(out.rows[2]?.warnings.join()).toContain("Year not recognized");
  });

  it("rejects rows with a malformed email", () => {
    const text = ["student_id,name,email", "2026-0045,Bad Mail,not-an-email"].join("\n");
    const out = parseClassList(text);
    expect(out.rows[0]?.errors.join()).toContain("email");
  });

  it("returns an empty result for empty input", () => {
    expect(parseClassList("").rows).toHaveLength(0);
    expect(parseClassList("   \n\n  ").rows).toHaveLength(0);
  });

  it("truncates over-long names and sections", () => {
    const text = ["student_id,name,section", `2026-0046,${"X".repeat(250)},${"S".repeat(80)}`].join(
      "\n",
    );
    const out = parseClassList(text);
    expect(out.rows[0]?.full_name?.length).toBe(200);
    expect(out.rows[0]?.section?.length).toBe(50);
    expect(out.rows[0]?.warnings.length).toBe(2);
    expect(out.rows[0]?.errors).toEqual([]);
  });
});

describe("reviewClassList", () => {
  const rows = parseClassList(
    [
      "student_id,name,year",
      "2026-0001,Alice Cruz,10",
      "2026-0002,Bob Santos,10",
      "2026-0001,Alice Again,10",
      "2026-0003,Carl Reyes,10",
      "2026-0004,Dina Lopez,10",
    ].join("\n"),
  ).rows;

  it("flags duplicates inside the paste and keeps the first copy", () => {
    const out = reviewClassList(rows);
    expect(out[2]?.status).toBe("duplicate");
    expect(out[2]?.include).toBe(false);
    expect(out[2]?.note).toContain("row 1");
    expect(out[0]?.status).toBe("new");
    expect(out[0]?.include).toBe(true);
  });

  it("marks matches against existing students and enrolled status", () => {
    const out = reviewClassList(rows, {
      existing: [{ id: "p-bob", student_id: "2026-0002", email: null }],
      enrolledIds: new Set(["p-bob"]),
    });
    expect(out[1]?.status).toBe("already-enrolled");
    expect(out[1]?.match_id).toBe("p-bob");
    expect(out[0]?.status).toBe("new");

    const emailRows = parseClassList(
      ["student_id,name,email", "2026-0003,Carl Reyes,carl@x.com"].join("\n"),
    ).rows;
    const out2 = reviewClassList(emailRows, {
      existing: [{ id: "p-carl", student_id: null, email: "carl@x.com" }],
    });
    expect(out2[0]?.status).toBe("existing");
    expect(out2[0]?.match_id).toBe("p-carl");
    expect(out2[0]?.note).toContain("enrolled");
  });

  it("excludes invalid rows", () => {
    const bad = parseClassList(["student_id,name", "2026-0007,"].join("\n")).rows;
    const out = reviewClassList(bad);
    expect(out[0]?.status).toBe("invalid");
    expect(out[0]?.include).toBe(false);
  });
});
