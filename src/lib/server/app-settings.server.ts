// App-wide admin settings (school-wide flags) — server-persisted so every
// device sees the same configuration. Currently one flag: the kiosk lockdown,
// which puts every student session on shared/kiosk devices under the app-wide
// hard lock (fullscreen + input blocking + wake lock).
//
// Persistence follows the native PostgreSQL schema migration for app_settings.
// Validation for the mutation lives here in the server path. User-facing
// changes remain behind administrator authorization.
import { z } from "zod";
import { db } from "@/integrations/db/client.server";
import { unwrap } from "@/lib/server/utils.server";

const KIOSK_LOCKDOWN_KEY = "kiosk_lockdown";

export interface AppSettingRow {
  key: string;
  enabled: boolean;
  updated_at: string;
}

/**
 * Input validation for the kiosk lockdown RPC. Owned by this module (not the
 * shared schemas module) so the setting keeps its validation server-side.
 */
export const kioskLockdownInput = z.object({
  enabled: z.boolean(),
  token: z.string().min(1).max(4096),
});

/**
 * Read the kiosk lockdown flag. A missing row (fresh database) reads as OFF —
 * app-wide lockdown is strictly opt-in.
 */
export async function getKioskLockdown(): Promise<boolean> {
  const rows = await unwrap<Pick<AppSettingRow, "enabled">[]>(
    db.from("app_settings").select("enabled").eq("key", KIOSK_LOCKDOWN_KEY),
  );
  return rows[0]?.enabled === true;
}

/**
 * Persist the kiosk lockdown flag. Strict boolean only — callers at the RPC
 * layer enforce admin-only. Returns the persisted value.
 */
export async function setKioskLockdown(enabled: boolean): Promise<boolean> {
  const value = z.boolean().parse(enabled);
  const now = new Date().toISOString();
  await unwrap(
    db
      .from("app_settings")
      .upsert({ key: KIOSK_LOCKDOWN_KEY, enabled: value, updated_at: now }, { onConflict: "key" }),
  );
  return value;
}
