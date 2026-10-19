// Streams course handouts and student submission files from the private
// "course-materials" bucket. The prefix is only "public" in the routing sense —
// every request must carry a valid signed LMS session cookie. Authorization
// and ?t= token support remains for old links during the migration.
//
// Access rules (P2a, user-signed 2026-10-06 — see src/lib/server/availability.ts):
//  - Course materials (handouts): staff (teacher/admin) always; students only
//    when enrolled in the course (path prefix = course_id) AND the file is open
//    under the materials-for-review policy: a file referenced by assessments is
//    downloadable once ANY referencing active assessment has opened and STAYS
//    downloadable afterward; files referenced by no assessment open with
//    enrollment. No attempt-gating, ever.
//  - Submission files: the owning student, or any staff member.
import { createFileRoute } from "@tanstack/react-router";
import { COOKIE_SESSION_MARKER } from "@/lib/session";

const PATH_RE_MATERIAL =
  /^[0-9a-f-]{36}\/material_\d+_[0-9a-f]{6,8}\.(pdf|docx?|pptx?|png|jpe?g|zip)$/;
const PATH_RE_SUBMISSION =
  /^submissions\/([0-9a-f-]{36})\/file_\d+_[0-9a-f]{6,8}\.(pdf|docx?|png|jpe?g|zip)$/;
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  zip: "application/zip",
};

export const Route = createFileRoute("/api/public/material")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const p = url.searchParams.get("p") ?? "";
        // Prefer Authorization header; ?t= is deprecated fallback
        const auth = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const t = auth || url.searchParams.get("t") || COOKIE_SESSION_MARKER;

        const isMaterial = PATH_RE_MATERIAL.test(p);
        const submissionMatch = p.match(PATH_RE_SUBMISSION);
        if (!isMaterial && !submissionMatch) return new Response("Bad Request", { status: 400 });
        const server = await import("@/lib/server");
        let caller;
        try {
          caller = await server.requireSession(t);
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }

        // Course materials: course-membership + any-open-wins attachment lookup.
        if (isMaterial) {
          const allowed = await server.canAccessCourseMaterialPath(caller, p);
          if (!allowed) return new Response("Forbidden", { status: 403 });
        }

        // Submission files are private: only the owning student or staff may read.
        if (submissionMatch) {
          const submissionId = submissionMatch[1]!;
          const { db } = await import("@/integrations/db/client.server");
          const { unwrap } = await import("@/lib/server/utils.server");
          const row = await unwrap<{ student_id: string } | null>(
            db.from("submissions").select("student_id").eq("id", submissionId).maybeSingle(),
          );
          if (!row) return new Response("Not found", { status: 404 });
          const isOwner = caller.id === row.student_id;
          const isStaff = caller.role === "admin" || caller.role === "teacher";
          if (!isOwner && !isStaff) return new Response("Forbidden", { status: 403 });
        }

        const { storage } = await import("@/integrations/db/client.server");
        const { data, error } = await storage.from("course-materials").download(p);
        if (error || !data) return new Response("Not found", { status: 404 });
        const ext = p.split(".").pop()!;
        return new Response(data, {
          headers: {
            "Content-Type": MIME[ext] ?? "application/octet-stream",
            "Content-Disposition": "inline",
            // Signed-in content: never cached by shared caches.
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
