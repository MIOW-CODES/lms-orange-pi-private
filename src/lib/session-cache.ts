export interface SessionCacheProfile {
  id: string;
  role: string;
}

export function sessionCacheIdentity(profile: SessionCacheProfile | null): string | null {
  return profile ? JSON.stringify([profile.id, profile.role]) : null;
}

/** Clear account-scoped in-memory data whenever the signed-in identity changes. */
export function updateSessionCacheIdentity(
  currentIdentity: string | null,
  profile: SessionCacheProfile | null,
  clearQueryCache: () => void,
): string | null {
  const nextIdentity = sessionCacheIdentity(profile);
  if (nextIdentity !== currentIdentity) clearQueryCache();
  return nextIdentity;
}
