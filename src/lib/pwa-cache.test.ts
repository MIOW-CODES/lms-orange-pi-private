import { describe, expect, it } from "bun:test";
import { clearLegacyNavigationCaches } from "./pwa-cache";

describe("clearLegacyNavigationCaches", () => {
  it("deletes only old Workbox navigation page caches", async () => {
    const deleted: string[] = [];
    const cacheStorage = {
      keys: async () => [
        "workbox-pages-https://akios.site/",
        "workbox-precache-v2-https://akios.site/",
        "workbox-google-fonts-webfonts-https://akios.site/",
        "pages",
      ],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    };

    await clearLegacyNavigationCaches(cacheStorage);
    expect(deleted.sort()).toEqual(["pages", "workbox-pages-https://akios.site/"]);
  });

  it("does not fail startup or logout when CacheStorage is unavailable", async () => {
    await expect(clearLegacyNavigationCaches(undefined)).resolves.toBeUndefined();
    await expect(
      clearLegacyNavigationCaches({
        keys: async () => {
          throw new Error("storage unavailable");
        },
        delete: async () => true,
      }),
    ).resolves.toBeUndefined();
  });
});
