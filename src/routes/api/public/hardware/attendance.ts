// Live check-in dispatch from the ESP32-P4 kiosk.
// POST /api/public/hardware/attendance
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { guardHardwareRequest } from "@/lib/server/hardware-auth.server";
import { readJsonBody } from "@/lib/server/read-json-body.server";

const Body = z
  .object({
    user_id: z.string().uuid().optional(),
    rfid_uid: z.string().min(1).max(64).optional(),
    timestamp: z.string().max(40).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .refine((b) => !!b.user_id || !!b.rfid_uid, {
    message: "user_id or rfid_uid is required",
  });

const MIN_CONFIDENCE = 0.45;
const MAX_BODY_BYTES = 8 * 1024;

export const Route = createFileRoute("/api/public/hardware/attendance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const guard = await guardHardwareRequest(request);
        if (!guard.ok) return guard.response;
        const parsedBody = await readJsonBody(request, MAX_BODY_BYTES);
        if (!parsedBody.ok) {
          const tooLarge = parsedBody.reason === "too_large";
          return Response.json(
            { ok: false, error: tooLarge ? "Payload too large" : "Invalid payload" },
            { status: tooLarge ? 413 : 400 },
          );
        }
        const parsedPayload = Body.safeParse(parsedBody.value);
        if (!parsedPayload.success) {
          return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });
        }
        const body: z.infer<typeof Body> = parsedPayload.data;
        if (body.confidence != null && body.confidence < MIN_CONFIDENCE) {
          return Response.json({ ok: false, error: "Low confidence match" }, { status: 422 });
        }
        const server = await import("@/lib/server");
        const result = body.user_id
          ? await server.recordTapByProfileId(body.user_id, body.timestamp)
          : await server.recordTap(body.rfid_uid!, body.timestamp);
        if (!result) return Response.json({ ok: false, error: "Unknown user" }, { status: 404 });
        return Response.json(
          {
            ok: true,
            student: { id: result.profile.id, full_name: result.profile.full_name },
            scan_type: result.scan_type,
            status: result.status,
            course: result.course,
            at: result.at,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
