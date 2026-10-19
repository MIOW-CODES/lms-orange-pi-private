import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { storage } from "./storage";

let tempRoot = "";
let previousStoragePath: string | undefined;

beforeEach(async () => {
  previousStoragePath = process.env["STORAGE_PATH"];
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "miow-storage-test-"));
  process.env["STORAGE_PATH"] = path.join(tempRoot, "storage");
});

afterEach(async () => {
  if (previousStoragePath === undefined) delete process.env["STORAGE_PATH"];
  else process.env["STORAGE_PATH"] = previousStoragePath;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("local PostgreSQL deployment file storage", () => {
  it("uploads, downloads, and removes a file under the selected bucket", async () => {
    const bucket = storage.from("course-materials");
    const uploaded = await bucket.upload("course-a/material.pdf", Buffer.from("pdf-data"));
    expect(uploaded.error).toBeNull();
    const downloaded = await bucket.download("course-a/material.pdf");
    expect(downloaded.error).toBeNull();
    expect(await downloaded.data?.text()).toBe("pdf-data");
    const removed = await bucket.remove(["course-a/material.pdf"]);
    expect(removed.error).toBeNull();
    expect(removed.data).toEqual({});
    expect((await bucket.download("course-a/material.pdf")).error).not.toBeNull();
  });

  it("rejects traversal and sibling-prefix paths without touching sibling files", async () => {
    const root = path.join(tempRoot, "storage");
    const sibling = path.join(tempRoot, "storage-evil");
    await fs.mkdir(sibling, { recursive: true });
    const outside = path.join(sibling, "secret.txt");
    await fs.writeFile(outside, "unchanged");

    const bucket = storage.from("avatars");
    expect((await bucket.download("../storage-evil/secret.txt")).error).not.toBeNull();
    expect(
      (await bucket.upload("../storage-evil/replaced.txt", Buffer.from("bad"))).error,
    ).not.toBeNull();
    expect((await bucket.remove(["../storage-evil/secret.txt"])).error).not.toBeNull();
    expect(await fs.readFile(outside, "utf8")).toBe("unchanged");
    await expect(fs.access(path.join(root, "avatars", "missing.txt"))).rejects.toThrow();
  });

  it("rejects absolute paths and invalid bucket names", async () => {
    const bucket = storage.from("../outside");
    expect((await bucket.upload("file.txt", Buffer.from("bad"))).error).not.toBeNull();
    const absolute = storage.from("avatars");
    expect((await absolute.download(path.join(tempRoot, "secret.txt"))).error).not.toBeNull();
  });

  it("validates every removal path before deleting any file", async () => {
    const bucketRoot = path.join(tempRoot, "storage", "course-materials");
    await fs.mkdir(bucketRoot, { recursive: true });
    const first = path.join(bucketRoot, "first.pdf");
    await fs.writeFile(first, "keep until all paths are validated");

    const removed = await storage.from("course-materials").remove(["first.pdf", "../escape.pdf"]);
    expect(removed.error).not.toBeNull();
    expect(await fs.readFile(first, "utf8")).toBe("keep until all paths are validated");
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks into paths outside the bucket",
    async () => {
      const bucketRoot = path.join(tempRoot, "storage", "avatars");
      const externalDir = path.join(tempRoot, "outside");
      await fs.mkdir(bucketRoot, { recursive: true });
      await fs.mkdir(externalDir, { recursive: true });
      const externalFile = path.join(externalDir, "secret.txt");
      await fs.writeFile(externalFile, "unchanged");
      await fs.symlink(externalFile, path.join(bucketRoot, "link.txt"));
      await fs.symlink(externalDir, path.join(bucketRoot, "linked-dir"), "dir");

      const bucket = storage.from("avatars");
      expect((await bucket.download("link.txt")).error).not.toBeNull();
      expect(
        (await bucket.upload("link.txt", Buffer.from("bad"), { upsert: true })).error,
      ).not.toBeNull();
      expect((await bucket.upload("linked-dir/new.txt", Buffer.from("bad"))).error).not.toBeNull();
      expect((await bucket.remove(["link.txt"])).error).not.toBeNull();
      expect(await fs.readFile(externalFile, "utf8")).toBe("unchanged");
      await expect(fs.access(path.join(externalDir, "new.txt"))).rejects.toThrow();
    },
  );
});
