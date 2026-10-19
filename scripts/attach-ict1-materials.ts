/**
 * Attach the ICT1 course slide decks to their quizzes (materials for the quiz
 * "Materials" sections). Uploads each local source pptx (docs/ICT1/) to the
 * `course-materials` storage bucket using the same path/attachment shape as the
 * app (src/lib/server/materials.server.ts) and then SETS each matching quiz's
 * `attachments` jsonb column to exactly the mapped deck list.
 *
 * This wholesale replacement is what strips the stale TVE100 PDFs currently
 * attached to the ICT1 quizzes (Quiz 1–4 / PRELIM / FINAL): every attachment
 * not on the mapped list is removed, and every removal/attachment is printed.
 *
 * Usage:
 *   bun run scripts/attach-ict1-materials.ts [--dry-run]
 *   bun run db:attach-ict1-materials
 *
 * Environment:
 *   DATABASE_URL     native PostgreSQL connection string
 *   STORAGE_PATH     local persistent upload directory (defaults to ./storage)
 *
 * The script updates PostgreSQL and uploads files to the same local storage
 * used by the application. Load private values from .env or the process env.
 *
 * Source files (docs/ICT1/, see QUIZ_MATERIALS below):
 *   ICT1_Week2 Productivity Tools.pptx
 *   ICT1_Week3 Spreadsheet Applications.pptx
 *   ICT1_Week4 Presentation Tools.pptx
 *   ICT1_Week5 Online Collaboration Tools.pptx
 *   ICT1_Week6 Learning Management Systems.pptx
 *   ICT1_Week7 Multimedia in Education.pptx
 *
 * Flags:
 *   --dry-run   Resolve course/quizzes and print the plan (adds + removals)
 *               without any writes.
 *   --help      Print this help and exit.
 *
 * Idempotent: a deck is kept when the quiz already has an attachment with the
 * same `name`, and the exact-list write is skipped when nothing changes, so a
 * second run attaches 0 / removes 0. A deck already present on another ICT1
 * quiz (Weeks 5–7 live in the bucket via the PRELIM row) is reused by storage
 * path instead of re-uploaded. Missing quizzes and missing local source files
 * warn and continue.
 */
import "dotenv/config";
import { config as dotenvConfig } from "dotenv";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { storage } from "../src/integrations/db/storage";

// Load local operator configuration without overriding the current process env.
dotenvConfig({ path: ".env.local" });

// ── Mirrors src/lib/server/materials.server.ts ─────────────────────────────
const MATERIAL_BUCKET = "course-materials";
const MAX_MATERIAL_BYTES = 25 * 1024 * 1024;
type Attachment = { name: string; url: string; size: number; type: string; path: string };

const EXT_TO_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip",
};
const MATERIAL_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
};

/** Same URL the app builds for serving materials — keep in sync. */
function materialUrlForPath(p: string): string {
  return `/api/public/material?p=${encodeURIComponent(p)}`;
}

function attachmentList(value: unknown): Attachment[] {
  return Array.isArray(value) ? (value as Attachment[]) : [];
}

// ── Quiz title → desired attachment list (exact end state) ─────────────────
// Files live in docs/ICT1/. Every quiz's `attachments` is SET to exactly this
// list; anything else currently on the quiz (the stale TVE100 PDFs) is removed.
// Quiz 1 (Week 1 orientation) has no deck → its attachments are cleared.
const DECKS = {
  week2: "ICT1_Week2 Productivity Tools.pptx",
  week3: "ICT1_Week3 Spreadsheet Applications.pptx",
  week4: "ICT1_Week4 Presentation Tools.pptx",
  week5: "ICT1_Week5 Online Collaboration Tools.pptx",
  week6: "ICT1_Week6 Learning Management Systems.pptx",
  week7: "ICT1_Week7 Multimedia in Education.pptx",
} as const;
const ALL_DECKS = [DECKS.week2, DECKS.week3, DECKS.week4, DECKS.week5, DECKS.week6, DECKS.week7];

const QUIZ_MATERIALS: Array<{ quiz: string; files: string[] }> = [
  { quiz: "Quiz 1", files: [] }, // Week 1 orientation — no deck; clear stale attachments.
  { quiz: "Quiz 2", files: [DECKS.week2] },
  { quiz: "Quiz 3", files: [DECKS.week3] },
  { quiz: "Quiz 4", files: [DECKS.week4] },
  { quiz: "Quiz 5", files: [DECKS.week5] },
  { quiz: "Quiz 6", files: [DECKS.week6] },
  { quiz: "Quiz 7", files: [DECKS.week7] },
  { quiz: "PRELIM EXAMINATION (Coverage: Weeks 1-7)", files: [...ALL_DECKS] },
  { quiz: "FINAL EXAMINATION (Coverage: Weeks 1-7)", files: [...ALL_DECKS] },
];

/** Source decks live under docs/ICT1/ in the repo. */
const SOURCE_DIR = path.join("docs", "ICT1");

// ── Config ─────────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function requiredDatabaseUrl(): string {
  const value = process.env["DATABASE_URL"]?.trim();
  if (!value) throw new Error("DATABASE_URL is required");
  return value;
}

/** Normalize titles so em/en/hyphen dashes and repeated spaces can't break matching. */
function normalizeTitle(v: string): string {
  return v
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type QuizRow = { id: string; course_id: string; title: string; attachments: unknown };

type FilePlan = {
  fileName: string;
  action:
    "keep" | "reuse" | "attach" | "would-attach" | "missing" | "remove" | "would-remove" | "failed";
  detail: string;
};

function planMark(action: FilePlan["action"]): string {
  switch (action) {
    case "attach":
      return "+";
    case "would-attach":
      return "~";
    case "reuse":
      return "r";
    case "keep":
      return "=";
    case "remove":
    case "would-remove":
    case "missing":
      return "-";
    case "failed":
      return "!";
    default:
      return "?";
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: bun run scripts/attach-ict1-materials.ts [--dry-run]\n" +
        "Env:   DATABASE_URL and optional STORAGE_PATH (see .env.example)",
    );
    return;
  }
  const dryRun = args.includes("--dry-run");
  const pool = new Pool({ connectionString: requiredDatabaseUrl(), max: 2 });

  try {
    // ── Resolve the ICT1 course at runtime — never hardcode IDs ──────────────
    const { rows: list } = await pool.query<{
      id: string;
      code: string | null;
      title: string | null;
    }>("SELECT id, code, title FROM public.courses WHERE code ILIKE $1", ["ICT1"]);
    const exact = list.filter((c) => (c.code ?? "").trim().toLowerCase() === "ict1");
    if (!exact.length) {
      throw new Error('No course matched code "ICT1".');
    }
    if (exact.length > 1) {
      throw new Error(
        "Ambiguous ICT1 course match — refusing to guess. Candidates:\n" +
          exact.map((c) => `  id=${c.id} code=${c.code ?? "-"} title=${c.title ?? "-"}`).join("\n"),
      );
    }
    const course = exact[0]!;
    console.log(
      `[attach-ict1] Course: "${course.title}" (code=${course.code ?? "-"}, id=${course.id})`,
    );
    if (dryRun) console.log("[attach-ict1] DRY RUN — no uploads or database writes will occur.");

    // ── Load this course's quizzes once ──────────────────────────────────────
    const { rows: quizzes } = await pool.query<QuizRow>(
      "SELECT id, course_id, title, attachments FROM public.quizzes WHERE course_id = $1 AND deleted_at IS NULL",
      [course.id],
    );

    // Same-named attachments already anywhere on this course's quizzes (Weeks 5–7
    // decks live in the bucket via the PRELIM row) are reused by storage path
    // instead of re-uploaded. Keyed by attachment name.
    const knownByName = new Map<string, Attachment>();
    for (const q of quizzes) {
      for (const a of attachmentList(q.attachments)) {
        if (a?.name && a.path && !knownByName.has(a.name)) knownByName.set(a.name, a);
      }
    }

    let totalUploaded = 0;
    let totalReused = 0;
    let totalKept = 0;
    let totalRemoved = 0;
    let totalWouldUpload = 0;
    let totalWouldRemove = 0;
    let totalMissing = 0;
    let totalQuizMissing = 0;
    let totalFailed = 0;

    for (const entry of QUIZ_MATERIALS) {
      const want = normalizeTitle(entry.quiz);
      const matches = quizzes.filter((q) => normalizeTitle(q.title ?? "") === want);
      console.log(`\n[attach-ict1] Quiz: "${entry.quiz}"`);

      if (!matches.length) {
        console.log(`  ! quiz not found in course — skipped`);
        totalQuizMissing++;
        continue;
      }
      if (matches.length > 1) {
        console.log(`  · ${matches.length} quizzes share this title — updating each`);
      }

      for (const quiz of matches) {
        const plan: FilePlan[] = [];
        const current = attachmentList(quiz.attachments);
        const desired: Attachment[] = [];

        // ── Build the exact desired list ─────────────────────────────────────
        for (const fileName of entry.files) {
          const name = fileName.slice(0, 200);

          // Already on this quiz → keep the existing entry as-is (idempotent).
          const existingHere = current.find((a) => a?.name === name);
          if (existingHere) {
            desired.push(existingHere);
            knownByName.set(name, existingHere);
            plan.push({ fileName, action: "keep", detail: "already attached — kept" });
            totalKept++;
            continue;
          }

          // Same-named attachment already stored for this course → reuse it.
          const known = knownByName.get(name);
          if (known) {
            desired.push(known);
            plan.push({
              fileName,
              action: "reuse",
              detail: `reusing existing storage object → ${known.path}`,
            });
            totalReused++;
            continue;
          }

          const abs = path.resolve(REPO_ROOT, SOURCE_DIR, fileName);
          if (!abs.startsWith(REPO_ROOT + path.sep)) {
            plan.push({
              fileName,
              action: "failed",
              detail: "FAILED — path escapes repo root",
            });
            totalFailed++;
            continue;
          }
          let size = 0;
          try {
            const info = await stat(abs);
            if (!info.isFile()) throw new Error("not a regular file");
            size = info.size;
          } catch {
            plan.push({
              fileName,
              action: "missing",
              detail: "source file not found — warned and skipped",
            });
            totalMissing++;
            continue;
          }

          if (dryRun) {
            plan.push({
              fileName,
              action: "would-attach",
              detail: `${size} bytes → would upload + attach`,
            });
            totalWouldUpload++;
            continue;
          }

          try {
            const buffer = await readFile(abs);
            const fileExt = path.extname(fileName).toLowerCase();
            const contentType = EXT_TO_MIME[fileExt];
            const ext = contentType ? MATERIAL_EXT[contentType] : undefined;
            if (!contentType || !ext) {
              throw new Error(`Unsupported file type (${fileExt || "no extension"})`);
            }

            // Same path convention + attachment shape as materials.server.ts.
            const rand = randomBytes(4).toString("hex");
            const objectPath = `${course.id}/material_${Date.now()}_${rand}.${ext}`;
            if (buffer.byteLength > MAX_MATERIAL_BYTES) {
              throw new Error(`File exceeds the ${MAX_MATERIAL_BYTES / 1048576} MB upload limit`);
            }
            const upload = await storage
              .from(MATERIAL_BUCKET)
              .upload(objectPath, buffer, { contentType, upsert: false });
            if (upload.error) throw new Error(`Storage upload failed (${upload.error.message})`);

            const attachment: Attachment = {
              name,
              url: materialUrlForPath(objectPath),
              size: buffer.byteLength,
              type: contentType,
              path: objectPath,
            };
            desired.push(attachment);
            knownByName.set(name, attachment);
            plan.push({ fileName, action: "attach", detail: `uploaded → ${objectPath}` });
            totalUploaded++;
          } catch (e) {
            totalFailed++;
            plan.push({
              fileName,
              action: "failed",
              detail: `FAILED — ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }

        // ── Everything not on the mapped list is removed (TVE100 PDF cleanup) ─
        const desiredNames = new Set(entry.files.map((f) => f.slice(0, 200)));
        const keptNames = new Set<string>();
        const removals: Attachment[] = [];
        for (const a of current) {
          const n = a?.name ?? "";
          if (a && desiredNames.has(n) && !keptNames.has(n)) {
            keptNames.add(n);
            continue;
          }
          removals.push(a);
          const label = a?.name ?? "(unnamed attachment)";
          if (dryRun) {
            plan.push({
              fileName: label,
              action: "would-remove",
              detail: `would remove — stale (path=${a?.path ?? "-"}, not one of ICT1's mapped decks)`,
            });
            totalWouldRemove++;
          } else {
            plan.push({
              fileName: label,
              action: "remove",
              detail: `removed — stale (path=${a?.path ?? "-"}, not one of ICT1's mapped decks)`,
            });
            totalRemoved++;
          }
        }

        // ── Write the exact list (skipped when nothing changed) ──────────────
        const changed =
          removals.length > 0 ||
          desired.length !== current.length ||
          desired.some((a, i) => a.name !== (current[i]?.name ?? ""));
        const tag = matches.length > 1 ? `[quiz id=${quiz.id}] ` : "";
        if (!changed) {
          for (const p of plan) {
            console.log(`  ${tag}${planMark(p.action)} ${p.fileName}: ${p.detail}`);
          }
          console.log(`  ${tag}· no change — attachments already exactly the mapped list`);
          continue;
        }
        if (!dryRun) {
          const updated = await pool.query<{ id: string }>(
            "UPDATE public.quizzes SET attachments = $1::jsonb WHERE id = $2 RETURNING id",
            [JSON.stringify(desired), quiz.id],
          );
          if (updated.rowCount !== 1) {
            totalFailed++;
            plan.push({
              fileName: "(attachments update)",
              action: "failed",
              detail: "FAILED — quiz was removed before attachments could be updated",
            });
          }
        }
        for (const p of plan) {
          console.log(`  ${tag}${planMark(p.action)} ${p.fileName}: ${p.detail}`);
        }
      }
    }

    console.log("\n[attach-ict1] Summary");
    if (dryRun) {
      console.log(`  would upload + attach: ${totalWouldUpload}`);
      console.log(`  would remove (stale):  ${totalWouldRemove}`);
    } else {
      console.log(`  attached (uploaded):       ${totalUploaded}`);
      console.log(`  reused (existing storage): ${totalReused}`);
      console.log(`  kept (already on quiz):    ${totalKept}`);
      console.log(`  removed (stale/unmapped):  ${totalRemoved}`);
    }
    console.log(`  missing:   ${totalMissing} (source file not found)`);
    console.log(`  quizzes missing: ${totalQuizMissing}`);
    console.log(`  failed:    ${totalFailed}`);
    if (totalFailed > 0) process.exitCode = 1;
    console.log("[attach-ict1] Done.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
