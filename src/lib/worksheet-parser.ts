// Parser for the strict four-section worksheet format produced by the
// ClassMate assistant (and the legacy "Question | A, B, C, D | answer"
// one-line format, kept as a fallback).
//
// Expected format (markdown-tolerant — headings, **bold**, and bullets are
// stripped before parsing):
//
//   Section I: Multiple Choice
//   Instructions: ...
//   1. Stem
//   A. Option
//   ...
//   Section II: Fill in the Blank
//   3. Sentence with ______ .
//   Section III: Matching Type
//   Column A:
//   5. Premise
//   Column B:
//   A. Definition
//   Section IV: Essay / Short Answer
//   8. Prompt
//   Answer Key:
//   1. B - explanation
//   3. Photosynthesis (Acceptable: carbon assimilation)
//   8. Rubric/Key Points: ...

export type ParsedQuestionKind = "mc" | "fill" | "matching" | "essay";

export interface ParsedQuestion {
  question: string;
  options: string[];
  /** Primary correct answer; acceptable variants joined with "||". Essays are prefixed "Rubric: ". */
  correct_answer: string;
  kind: ParsedQuestionKind;
}

export interface ParseResult {
  questions: ParsedQuestion[];
  /** Items that looked like questions but were unusable (missing options or key). */
  dropped: number;
}

/** Strip markdown decoration so copied chat output parses cleanly. */
function clean(line: string): string {
  return (
    line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^>\s?/, "")
      .replace(/^[-*•]\s+(?=[A-Za-z][.)]\s)/, "") // bullet before a lettered option ("- A. ...")
      .replace(/\*\*/g, "")
      // Strip metadata labels like [WS-SCI10-001] or [QUIZ-001]
      .replace(/^\[[\w-]+\]\s*/i, "")
      // Strip "Question N:" or "Question N." prefix that ClassMate sometimes adds
      .replace(/^Question\s+\d+\s*[.:]\s*/i, "")
      // Strip horizontal rules (---, ***, ___)
      .replace(/^[-*_]{3,}\s*$/, "")
      // Strip table rows (| col | col |)
      .replace(/^\|.*\|$/, "")
      .trim()
  );
}

const ITEM_RE = /^(\d{1,3})[.)]\s+(.+)$/;
// Match lettered options: A. B. C. D. (also A) B) etc.)
const OPT_RE = /^([A-Z])[.)]\s+(.+)$/;

function splitInlineItems(line: string): Array<{ num: number; text: string }> {
  const matches = [...line.matchAll(/(?:^|\s)(\d{1,3})[.)]\s+(.+?)(?=\s+\d{1,3}[.)]\s+|$)/g)];
  return matches.map((match) => ({ num: Number(match[1]), text: match[2]!.trim() }));
}

function splitInlineOptions(line: string): Array<{ letter: string; text: string }> {
  // Match lettered options with various separators: A. A) A:
  const matches = [...line.matchAll(/(?:^|\s)([A-Z])[.)]\s+(.+?)(?=\s+[A-Z][.)]\s+|$)/g)];
  return matches.map((match) => ({ letter: match[1]!, text: match[2]!.trim() }));
}

function detectSection(line: string): ParsedQuestionKind | null {
  const l = line.toLowerCase();
  const isHeading =
    /^section\s+[ivx1-4]+[\s:—–-]/.test(l) ||
    /^(multiple choice|fill in the blank|matching type|essay\s*\/\s*short answer)$/.test(l);
  if (!isHeading) return null;
  // Keyword matching wins over the roman numeral so that re-numbered or
  // subset headings (e.g. "Section II: Essay / Short Answer" when the teacher
  // selected only MC + Essay) still resolve to the correct kind.
  if (/multiple choice/.test(l)) return "mc";
  if (/fill in the blank/.test(l)) return "fill";
  if (/matching/.test(l)) return "matching";
  if (/essay|short answer/.test(l)) return "essay";
  // Roman-numeral fallback for bare headings like "Section II:".
  if (/section\s+(i|1)[\s:—–-]/.test(l)) return "mc";
  if (/section\s+(ii|2)[\s:—–-]/.test(l)) return "fill";
  if (/section\s+(iii|3)[\s:—–-]/.test(l)) return "matching";
  if (/section\s+(iv|4)[\s:—–-]/.test(l)) return "essay";
  return null;
}

interface KeyEntry {
  letter?: string; // MC / matching
  primary?: string; // fill in the blank
  acceptable: string[]; // fill in the blank synonyms
  rubric?: string; // essay
}

function parseKeyEntry(body: string): KeyEntry {
  const rubric =
    body.match(/^rubric\/?\s*key points?\s*:?\s*(.*)$/i) ?? body.match(/^rubric\s*:?\s*(.*)$/i);
  if (rubric) return { rubric: rubric[1]!.trim(), acceptable: [] };
  // Match single letter answer (e.g. "B", "B - explanation") but NOT words starting with uppercase (e.g. "Articulated")
  const letter = body.match(/^([A-Z])\s*(?:[-–—:.]|\s*$)\s*(.*)$/);
  if (letter) return { letter: letter[1]!, acceptable: [] };
  const acceptableMatch = body.match(/\(acceptable:\s*([^)]*)\)/i);
  const acceptable = acceptableMatch
    ? acceptableMatch[1]!
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  // Strip (Acceptable: ...) first, then strip explanation after " - " or " – "
  // Use last " - " occurrence to avoid stripping dashes inside the answer itself
  const stripped = body.replace(/\(acceptable:\s*[^)]*\)/i, "").trim();
  const dashIdx = stripped.lastIndexOf(" - ");
  const dashIdx2 = stripped.lastIndexOf(" – ");
  const dashIdx3 = stripped.lastIndexOf(" — ");
  const cutAt = Math.max(dashIdx, dashIdx2, dashIdx3);
  const primary = cutAt > 0 ? stripped.slice(0, cutAt).trim() : stripped;
  return { primary, acceptable };
}

/** True when the text uses the four-section worksheet format. */
export function looksLikeWorksheet(text: string): boolean {
  return text.split("\n").some((raw) => detectSection(clean(raw)) !== null);
}

export function parseWorksheet(text: string): ParseResult {
  const lines = text.split("\n").map(clean);

  // Split body vs answer key.
  const keyStart = lines.findIndex((l) => /^answer key\b/i.test(l));
  const bodyLines = keyStart >= 0 ? lines.slice(0, keyStart) : lines;
  const keyLines = keyStart >= 0 ? lines.slice(keyStart + 1) : [];

  // Answer key entries by item number.
  const keyByNum = new Map<number, KeyEntry>();
  const unnumberedKeys: KeyEntry[] = [];
  for (const line of keyLines) {
    const m = line.match(ITEM_RE);
    if (m) keyByNum.set(parseInt(m[1]!, 10), parseKeyEntry(m[2]!));
    else if (line) unnumberedKeys.push(parseKeyEntry(line));
  }

  // Walk the body.
  type McItem = { num: number; stem: string; options: string[] };
  const mcItems: McItem[] = [];
  const fillItems: Array<{ num: number; stem: string }> = [];
  const essayItems: Array<{ num: number; stem: string }> = [];
  const premises: Array<{ num: number; text: string }> = [];
  const columnB: Array<{ letter: string; text: string }> = [];

  let section: ParsedQuestionKind | null = null;
  let column: "A" | "B" | null = null;
  let currentMc: McItem | null = null;
  let lastStem: { num: number; stem: string } | null = null;
  let nextAutoNum = 1;

  const reserveNumber = (explicit?: number) => {
    if (explicit != null) {
      nextAutoNum = Math.max(nextAutoNum, explicit + 1);
      return explicit;
    }
    return nextAutoNum++;
  };

  /** Detect if a line is a fill-in-the-blank stem (has underscores). */
  const isFillLine = (line: string): boolean => /_{2,}/.test(line);

  for (const line of bodyLines) {
    if (!line) continue;
    if (/^instructions?\s*:/i.test(line)) continue;
    // Only stop at TOS if we're already inside a section (TOS mid-body = end of content)
    if (section && /^table of specifications|^tos\b/i.test(line)) break;

    const next = detectSection(line);
    if (next) {
      section = next;
      column = null;
      currentMc = null;
      lastStem = null;
      continue;
    }
    if (!section) {
      // Auto-detect: if we see a numbered item or lettered options, assume MC.
      // Also detect fill items (lines with underscores).
      if (ITEM_RE.test(line) || OPT_RE.test(line)) {
        section = "mc";
      } else if (isFillLine(line)) {
        section = "fill";
      } else {
        continue;
      }
    }

    if (section === "matching") {
      const columnAHeader = line.match(/^column\s*a\s*:\s*(.*)$/i);
      if (columnAHeader) {
        column = "A";
        for (const item of splitInlineItems(columnAHeader[1] ?? "")) {
          premises.push({ num: reserveNumber(item.num), text: item.text });
        }
        continue;
      }
      const columnBHeader = line.match(/^column\s*b\s*:\s*(.*)$/i);
      if (columnBHeader) {
        column = "B";
        for (const option of splitInlineOptions(columnBHeader[1] ?? "")) columnB.push(option);
        continue;
      }
      const item = line.match(ITEM_RE);
      if (item && column !== "B") {
        premises.push({ num: reserveNumber(parseInt(item[1]!, 10)), text: item[2]!.trim() });
        continue;
      }
      const opt = line.match(OPT_RE);
      if (opt && (column === "B" || column === null)) {
        column = "B";
        columnB.push({ letter: opt[1]!, text: opt[2]!.trim() });
      }
      continue;
    }

    const item = line.match(ITEM_RE);
    if (item) {
      const num = reserveNumber(parseInt(item[1]!, 10));
      if (section === "mc") {
        currentMc = { num, stem: item[2]!.trim(), options: [] };
        mcItems.push(currentMc);
        lastStem = null;
        continue;
      } else {
        const entry = { num, stem: item[2]!.trim() };
        (section === "fill" ? fillItems : essayItems).push(entry);
        lastStem = entry;
        currentMc = null;
        continue;
      }
    }

    // Handle case where ClassMate outputs stem without number but with inline options
    if (section === "mc") {
      const options = splitInlineOptions(line);
      if (options.length >= 2) {
        const firstOption = line.search(/(?:^|\s)[A-Z][.)]\s+/);
        const stem = line.slice(0, firstOption).trim();
        if (stem) {
          currentMc = { num: reserveNumber(), stem, options: options.map((option) => option.text) };
          mcItems.push(currentMc);
          continue;
        }
      }
    }

    // Fill and essay prompts are commonly copied as unnumbered paragraphs.
    if (section === "fill" && isFillLine(line)) {
      const entry = { num: reserveNumber(), stem: line };
      fillItems.push(entry);
      lastStem = entry;
      continue;
    }
    if (section === "essay") {
      const entry = { num: reserveNumber(), stem: line };
      essayItems.push(entry);
      lastStem = entry;
      continue;
    }

    const opt = line.match(OPT_RE);
    if (section === "mc" && opt && currentMc) {
      currentMc.options.push(opt[2]!.trim());
      continue;
    }

    // Continuation of a wrapped stem.
    if (lastStem && section !== "mc") lastStem.stem += " " + line;
    else if (currentMc && !opt) currentMc.stem += " " + line;
  }

  // ── Post-parse: infer section for mixed items ──────────────────────
  // ClassMate sometimes mixes fill items into MC without a section break.
  // Detect fill items that ended up in mcItems (have underscores, no options).
  for (let i = mcItems.length - 1; i >= 0; i--) {
    const mc = mcItems[i]!;
    if (mc.options.length === 0 && isFillLine(mc.stem)) {
      fillItems.push({ num: mc.num, stem: mc.stem });
      mcItems.splice(i, 1);
    }
  }

  // ── Pair unnumbered keys with body items ───────────────────────────
  // Explicitly numbered keys always take precedence.
  const orderedItemNumbers = [
    ...mcItems.map((item) => item.num),
    ...fillItems.map((item) => item.num),
    ...premises.map((item) => item.num),
    ...essayItems.map((item) => item.num),
  ];

  // First pass: pair numbered keys
  // Second pass: pair unnumbered keys, validating type match
  let unnumberedMcIdx = 0;
  let unnumberedFillIdx = 0;

  // Separate unnumbered keys by type
  const unnumberedMcKeys: KeyEntry[] = [];
  const unnumberedFillKeys: KeyEntry[] = [];
  for (const key of unnumberedKeys) {
    if (key.letter) unnumberedMcKeys.push(key);
    else if (key.primary) unnumberedFillKeys.push(key);
  }

  for (const num of orderedItemNumbers) {
    if (keyByNum.has(num)) continue;
    // Check if this is an MC item or a fill item
    const isMc = mcItems.some((item) => item.num === num);
    if (isMc && unnumberedMcKeys[unnumberedMcIdx]) {
      keyByNum.set(num, unnumberedMcKeys[unnumberedMcIdx]!);
      unnumberedMcIdx += 1;
    } else if (!isMc && unnumberedFillKeys[unnumberedFillIdx]) {
      keyByNum.set(num, unnumberedFillKeys[unnumberedFillIdx]!);
      unnumberedFillIdx += 1;
    }
  }

  // Fallback: pair remaining unnumbered keys in order (ignoring type)
  let fallbackIdx = 0;
  for (const num of orderedItemNumbers) {
    if (keyByNum.has(num)) continue;
    if (unnumberedKeys[fallbackIdx]) {
      keyByNum.set(num, unnumberedKeys[fallbackIdx]!);
      fallbackIdx += 1;
    }
  }

  // ── Build questions ────────────────────────────────────────────────
  const questions: ParsedQuestion[] = [];
  let dropped = 0;
  const letterIdx = (letter?: string) => (letter ? letter.toUpperCase().charCodeAt(0) - 65 : -1);

  for (const item of mcItems) {
    const key = keyByNum.get(item.num);
    const idx = letterIdx(key?.letter);
    const correct = idx >= 0 ? item.options[idx] : undefined;
    if (item.options.length >= 2 && correct) {
      questions.push({
        question: item.stem,
        options: item.options,
        correct_answer: correct,
        kind: "mc",
      });
    } else dropped += 1;
  }

  for (const item of fillItems) {
    const key = keyByNum.get(item.num);
    if (key?.primary) {
      const variants = [key.primary, ...key.acceptable].filter(Boolean);
      questions.push({
        question: item.stem,
        options: [],
        correct_answer: variants.join("||"),
        kind: "fill",
      });
    } else dropped += 1;
  }

  for (const premise of premises) {
    const key = keyByNum.get(premise.num);
    const idx = letterIdx(key?.letter);
    const correct = idx >= 0 ? columnB[idx]?.text : undefined;
    if (columnB.length >= 2 && correct) {
      questions.push({
        question: premise.text,
        options: columnB.map((o) => o.text),
        correct_answer: correct,
        kind: "matching",
      });
    } else dropped += 1;
  }

  for (const item of essayItems) {
    const key = keyByNum.get(item.num);
    const rubric = key?.rubric ?? key?.primary ?? "Teacher review against the discussed concepts.";
    questions.push({
      question: item.stem,
      options: [],
      correct_answer: `Rubric: ${rubric}`,
      kind: "essay",
    });
  }

  // Legacy fallback: one question per line — "Question | A, B, C, D | answer".
  if (questions.length === 0 && dropped === 0) {
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const [question, opts, correct] = line.split("|").map((s) => s.trim());
      const options = (opts ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (question && options.length >= 2 && correct) {
        questions.push({ question, options, correct_answer: correct, kind: "mc" });
      } else if (question) dropped += 1;
    }
  }

  return { questions, dropped };
}
