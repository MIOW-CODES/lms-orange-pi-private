const LOCAL_AVATAR_PATH = "/api/public/avatar";
const AVATAR_ORIGIN = "https://miow.invalid";

/** Accept only a same-origin avatar capability URL with exactly one `p` value. */
export function isLocalAvatarUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(`${LOCAL_AVATAR_PATH}?p=`)) return false;

  try {
    const parsed = new URL(value, AVATAR_ORIGIN);
    return (
      parsed.origin === AVATAR_ORIGIN &&
      parsed.pathname === LOCAL_AVATAR_PATH &&
      parsed.hash === "" &&
      parsed.searchParams.getAll("p").length === 1 &&
      (parsed.searchParams.get("p")?.length ?? 0) > 0 &&
      Array.from(parsed.searchParams.keys()).every((key) => key === "p")
    );
  } catch {
    return false;
  }
}

export function localAvatarUrlOrNull(value: unknown): string | null {
  return isLocalAvatarUrl(value) ? value : null;
}

/** Blob URLs are allowed only for the temporary image preview before upload. */
export function avatarImageSource(value: unknown, allowBlobPreview = false): string | null {
  if (isLocalAvatarUrl(value)) return value;
  if (allowBlobPreview && typeof value === "string" && value.startsWith("blob:")) return value;
  return null;
}
