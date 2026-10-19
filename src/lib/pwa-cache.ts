type CacheStorageLike = Pick<CacheStorage, "keys" | "delete">;

/** Remove authenticated navigation caches created by older Workbox releases. */
export async function clearLegacyNavigationCaches(
  cacheStorage: CacheStorageLike | undefined = typeof caches === "undefined" ? undefined : caches,
): Promise<void> {
  if (!cacheStorage) return;
  try {
    const names = await cacheStorage.keys();
    await Promise.all(
      names
        .filter((name) => name === "pages" || name.startsWith("workbox-pages-"))
        .map((name) => cacheStorage.delete(name)),
    );
  } catch {
    // Cache cleanup must not block sign-out or application startup.
  }
}
