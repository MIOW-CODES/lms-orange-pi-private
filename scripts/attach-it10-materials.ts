/**
 * Attach the IT 10 source materials to their quizzes (materials for the quiz
 * "Materials" sections). Uploads each local source PDF to the `course-materials`
 * storage bucket using the same path/attachment shape as the app
 * (src/lib/server/materials.server.ts) and appends the attachment to the
 * matching quiz's `attachments` jsonb column.
 *
 * Usage:
 *   bun run scripts/attach-it10-materials.ts [--dry-run]
 *   bun run db:attach-it10-materials
 *
 * Environment:
 *   DATABASE_URL     native PostgreSQL connection string
 *   STORAGE_PATH     local persistent upload directory (defaults to ./storage)
 *
 * The script updates PostgreSQL and uploads files to the same local storage
 * used by the application. Load private values from .env or the process env.
 *
 * Source files (`docs/IT10/source-materials/` — see QUIZ_MATERIALS below):
 *   Arduino Part 1 - Classroom.pdf
 *   Arduino Part 2.pdf
 *   Resistor Color Code.pdf
 *   Programming with Arduino.pdf
 *   Lab Activity 1_Blinking LED (WordFile_PDF) - Classroom.pdf
 *
 * Flags:
 *   --dry-run   Resolve course/quizzes and print the plan without any writes.
 *   --help      Print this help and exit.
 *
 * Idempotent: a file is skipped when the quiz already has an attachment with
 * the same `name`, so the script is safe to re-run. Missing source files warn
 * and continue.
 *
 * NEVER DISTRIBUTE: the quiz must not receive the answer key / live exam files.
 * This script hard-blocks them (see NEVER_ATTACH) even if the mapping below is
 * ever edited to ask for them:
 *   - "IT 10 - 1st Quarter Exam - Questions with Key (TEACHER COPY).pdf"
 *   - "1st Quarter Exam.docx"
 *   - "TOS - IT 10 - 1st Quarter Exam.pdf"
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

// ── Files that must NEVER reach students ───────────────────────────────────
const NEVER_ATTACH = new Set([
  "IT 10 - 1st Quarter Exam - Questions with Key (TEACHER COPY).pdf",
  "1st Quarter Exam.docx",
  "TOS - IT 10 - 1st Quarter Exam.pdf",
]);

// ── Quiz title → source files (files live at the repo root) ────────────────
const SOURCE_DIR = "docs/IT10/source-materials";
const source = (name: string) => path.join(SOURCE_DIR, name);
const QUIZ_MATERIALS: Array<{ quiz: string; files: string[] }> = [
  { quiz: "Quiz — Arduino Part 1", files: [source("Arduino Part 1 - Classroom.pdf")] },
  { quiz: "Quiz — Arduino Part 2", files: [source("Arduino Part 2.pdf")] },
  { quiz: "Quiz — Resistor Color Code", files: [source("Resistor Color Code.pdf")] },
  { quiz: "Quiz — Programming with Arduino", files: [source("Programming with Arduino.pdf")] },
  {
    quiz: "Quiz — Lab Activity 1 (Blinking LED)",
    files: [source("Lab Activity 1_Blinking LED (WordFile_PDF) - Classroom.pdf")],
  },
  {
    quiz: "1st Quarter Exam",
    // Review materials only — the exam itself / answer key are NEVER attached.
    files: [
      source("Arduino Part 1 - Classroom.pdf"),
      source("Arduino Part 2.pdf"),
      source("Resistor Color Code.pdf"),
      source("Programming with Arduino.pdf"),
    ],
  },
];

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
  action: "blocked" | "missing" | "skip-existing" | "attach" | "would-attach";
  detail: string;
};

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "Usage: bun run scripts/attach-it10-materials.ts [--dry-run]\n" +
        "Env:   DATABASE_URL and optional STORAGE_PATH (see .env.example)",
    );
    return;
  }
  const dryRun = args.includes("--dry-run");
  const pool = new Pool({ connectionString: requiredDatabaseUrl(), max: 2 });

  try {
    // ── Resolve the IT 10 course at runtime — never hardcode IDs ─────────────
    const [byCode, byTitle] = await Promise.all([
      pool.query<{ id: string; code: string | null; title: string | null }>(
        "SELECT id, code, title FROM public.courses WHERE code ILIKE $1",
        ["IT10"],
      ),
      pool.query<{ id: string; code: string | null; title: string | null }>(
        "SELECT id, code, title FROM public.courses WHERE title ILIKE $1",
        ["%IT 10%"],
      ),
    ]);
    const candidates = new Map<string, { id: string; code: string | null; title: string | null }>();
    for (const row of [...byCode.rows, ...byTitle.rows]) candidates.set(row.id, row);
    const list = [...candidates.values()];
    if (!list.length) {
      throw new Error('No course matched title ILIKE "%IT 10%" or code "IT10".');
    }
    const exactCode = list.find((c) => (c.code ?? "").trim().toLowerCase() === "it10");
    const course = exactCode ?? (list.length === 1 ? list[0]! : null);
    if (!course) {
      throw new Error(
        "Ambiguous IT 10 course match — refusing to guess. Candidates:\n" +
          list.map((c) => `  id=${c.id} code=${c.code ?? "-"} title=${c.title ?? "-"}`).join("\n"),
      );
    }
    console.log(
      `[attach-it10] Course: "${course.title}" (code=${course.code ?? "-"}, id=${course.id})`,
    );
    if (dryRun) console.log("[attach-it10] DRY RUN — no uploads or database writes will occur.");

    // ── Load this course's quizzes once ──────────────────────────────────────
    const { rows: quizzes } = await pool.query<QuizRow>(
      "SELECT id, course_id, title, attachments FROM public.quizzes WHERE course_id = $1 AND deleted_at IS NULL",
      [course.id],
    );

    let totalAttached = 0;
    let totalSkipped = 0;
    let totalBlocked = 0;
    let totalMissing = 0;
    let totalFailed = 0;

    for (const entry of QUIZ_MATERIALS) {
      const want = normalizeTitle(entry.quiz);
      const matches = quizzes.filter((q) => normalizeTitle(q.title ?? "") === want);
      console.log(`\n[attach-it10] Quiz: "${entry.quiz}"`);

      if (!matches.length) {
        console.log(`  ! quiz not found in course — skipped`);
        totalSkipped += entry.files.length;
        continue;
      }
      if (matches.length > 1) {
        console.log(`  · ${matches.length} quizzes share this title — attaching to each`);
      }

      for (const quiz of matches) {
        const plan: FilePlan[] = [];
        let current = attachmentList(quiz.attachments);

        for (const fileName of entry.files) {
          const displayName = path.basename(fileName);
          // Hard rule: answer key / live exam / TOS files never get attached.
          if (NEVER_ATTACH.has(path.basename(fileName))) {
            plan.push({
              fileName,
              action: "blocked",
              detail: "skipped — DO NOT DISTRIBUTE (teacher copy / live exam / TOS)",
            });
            totalBlocked++;
            continue;
          }

          const existing = current.find((a) => a?.name === displayName.slice(0, 200));
          if (existing) {
            plan.push({ fileName, action: "skip-existing", detail: "already attached" });
            totalSkipped++;
            continue;
          }

          const abs = path.resolve(REPO_ROOT, fileName);
          if (!abs.startsWith(REPO_ROOT + path.sep)) {
            plan.push({ fileName, action: "blocked", detail: "skipped — path escapes repo root" });
            totalBlocked++;
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
              name: displayName.slice(0, 200),
              url: materialUrlForPath(objectPath),
              size: buffer.byteLength,
              type: contentType,
              path: objectPath,
            };

            // Append atomically only if another run has not already attached this name.
            const updated = await pool.query<{ attachments: unknown }>(
              `UPDATE public.quizzes
             SET attachments = (CASE WHEN jsonb_typeof(attachments) = 'array' THEN attachments ELSE '[]'::jsonb END) || $1::jsonb
             WHERE id = $2
               AND NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(attachments) = 'array' THEN attachments ELSE '[]'::jsonb END
                 ) AS item WHERE item->>'name' = $3
               )
             RETURNING attachments`,
              [JSON.stringify([attachment]), quiz.id, attachment.name],
            );
            if (updated.rowCount === 0) {
              const fresh = await pool.query<{ attachments: unknown }>(
                "SELECT attachments FROM public.quizzes WHERE id = $1",
                [quiz.id],
              );
              current = attachmentList(fresh.rows[0]?.attachments);
              if (!fresh.rows.length) throw new Error("Quiz no longer exists");
              plan.push({
                fileName,
                action: "skip-existing",
                detail: "already attached (re-run race)",
              });
              totalSkipped++;
              continue;
            }
            current = attachmentList(updated.rows[0]?.attachments);
            plan.push({ fileName, action: "attach", detail: `uploaded → ${objectPath}` });
            totalAttached++;
          } catch (e) {
            totalFailed++;
            plan.push({
              fileName,
              action: "missing",
              detail: `FAILED — ${e instanceof Error ? e.message : String(e)}`,
            });
          }
        }

        const tag = matches.length > 1 ? `[quiz id=${quiz.id}] ` : "";
        for (const p of plan) {
          const mark =
            p.action === "attach"
              ? "+"
              : p.action === "would-attach"
                ? "~"
                : p.action === "blocked"
                  ? "x"
                  : p.action === "missing" && p.detail.startsWith("FAILED")
                    ? "!"
                    : "-";
          console.log(
            `  ${tag}${mark} ${p.fileName}: ${p.action === "attach" ? "attached" : p.detail}`,
          );
        }
      }
    }

    console.log("\n[attach-it10] Summary");
    console.log(`  attached:  ${totalAttached}`);
    console.log(`  skipped:   ${totalSkipped} (already attached or quiz not found)`);
    console.log(`  blocked:   ${totalBlocked} (DO NOT DISTRIBUTE / invalid path)`);
    console.log(`  missing:   ${totalMissing} (source file not found)`);
    console.log(`  failed:    ${totalFailed}`);
    if (totalFailed > 0) process.exitCode = 1;
    console.log("[attach-it10] Done.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
