import { createFileRoute } from "@tanstack/react-router";
import { getPoolRaw } from "@/integrations/db/client.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        try {
          await getPoolRaw().query("SELECT 1");
          return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code).slice(0, 5)
              : "unknown";
          console.error("[health] database unavailable", { code });
          return Response.json(
            { status: "unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }
      },
    },
  },
});
