// Local filesystem storage for avatars and course materials.
// Files live under STORAGE_PATH/<bucket>/<path> and are served only by app routes.

import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

type StorageError = { message: string; code?: string };
type StorageResult<T> = { data: T | null; error: StorageError | null };
type Target = { root: string; bucketRoot: string; full: string };

function storageRoot(): string {
  return path.resolve(process.env["STORAGE_PATH"] ?? path.join(process.cwd(), "storage"));
}

function isWithinOrSame(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function resolveBucket(bucket: string): { root: string; bucketRoot: string } {
  if (!/^[a-z][a-z0-9-]*$/i.test(bucket)) throw new Error("Invalid bucket");
  const root = storageRoot();
  const bucketRoot = path.resolve(root, bucket);
  if (bucketRoot === root || !isWithinOrSame(root, bucketRoot)) throw new Error("Invalid bucket");
  return { root, bucketRoot };
}

function resolveTarget(bucket: string, filePath: string): Target {
  const { root, bucketRoot } = resolveBucket(bucket);
  if (typeof filePath !== "string" || filePath.length === 0) throw new Error("Invalid path");
  if (path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)) throw new Error("Invalid path");
  const parts = filePath.split(/[\\/]/);
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("Invalid path");
  }
  const full = path.resolve(bucketRoot, filePath);
  if (full === bucketRoot || !isWithinOrSame(bucketRoot, full)) throw new Error("Invalid path");
  return { root, bucketRoot, full };
}

async function realBucketRoot(root: string, bucketRoot: string): Promise<string> {
  await fs.mkdir(bucketRoot, { recursive: true });
  const [realRoot, realBucket] = await Promise.all([fs.realpath(root), fs.realpath(bucketRoot)]);
  if (realBucket === realRoot || !isWithinOrSame(realRoot, realBucket)) {
    throw new Error("Invalid storage bucket path");
  }
  return realBucket;
}

/** Resolve a target one directory at a time so a symlink cannot redirect mkdir outside the bucket. */
async function safeTargetPath(
  target: Target,
  realBucket: string,
  createParents: boolean,
): Promise<string> {
  const relative = path.relative(target.bucketRoot, target.full);
  if (!relative || !isWithinOrSame(target.bucketRoot, target.full)) throw new Error("Invalid path");
  const parts = relative.split(path.sep);
  const fileName = parts.pop();
  if (!fileName || fileName === "." || fileName === "..") throw new Error("Invalid path");

  let parent = realBucket;
  for (const part of parts) {
    const next = path.join(parent, part);
    try {
      const stat = await fs.lstat(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Invalid storage path");
    } catch (error) {
      if ((error as { code?: string })?.code !== "ENOENT" || !createParents) throw error;
      await fs.mkdir(next);
      const stat = await fs.lstat(next);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Invalid storage path");
    }
    const realNext = await fs.realpath(next);
    if (!isWithinOrSame(realBucket, realNext)) throw new Error("Invalid storage path");
    parent = realNext;
  }

  const full = path.join(parent, fileName);
  try {
    const stat = await fs.lstat(full);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Invalid storage file");
    const realFile = await fs.realpath(full);
    if (!isWithinOrSame(realBucket, realFile)) throw new Error("Invalid storage path");
  } catch (error) {
    if ((error as { code?: string })?.code !== "ENOENT") throw error;
  }
  return full;
}

function toStorageError(error: unknown): StorageError {
  const value = error as { message?: string; code?: string };
  return { message: value?.message ?? String(error), ...(value?.code ? { code: value.code } : {}) };
}

export const storage = {
  from(bucket: string) {
    return {
      async upload(
        filePath: string,
        data: Buffer | Uint8Array,
        opts?: { contentType?: string; upsert?: boolean },
      ): Promise<StorageResult<{ path: string }>> {
        try {
          const target = resolveTarget(bucket, filePath);
          const bucketRoot = await realBucketRoot(target.root, target.bucketRoot);
          const full = await safeTargetPath(target, bucketRoot, true);
          const noFollow = constants.O_NOFOLLOW ?? 0;
          const flags =
            constants.O_WRONLY |
            constants.O_CREAT |
            (opts?.upsert ? constants.O_TRUNC : constants.O_EXCL) |
            noFollow;
          const handle = await fs.open(full, flags, 0o600);
          try {
            await handle.writeFile(Buffer.isBuffer(data) ? data : Buffer.from(data));
          } finally {
            await handle.close();
          }
          // Attachment metadata carries contentType; no filesystem sidecar is needed.
          void opts?.contentType;
          return { data: { path: filePath }, error: null };
        } catch (error) {
          return { data: null, error: toStorageError(error) };
        }
      },

      async download(filePath: string): Promise<StorageResult<Blob>> {
        try {
          const target = resolveTarget(bucket, filePath);
          const bucketRoot = await realBucketRoot(target.root, target.bucketRoot);
          const full = await safeTargetPath(target, bucketRoot, false);
          const buf = await fs.readFile(full);
          return { data: new Blob([buf]), error: null };
        } catch (error) {
          return { data: null, error: toStorageError(error) };
        }
      },

      async remove(paths: string[]): Promise<StorageResult<Record<string, never>>> {
        try {
          if (!Array.isArray(paths)) throw new Error("Invalid paths");
          const targets = paths.map((filePath) => resolveTarget(bucket, filePath));
          const bucketPath = resolveBucket(bucket);
          const bucketRoot = await realBucketRoot(bucketPath.root, bucketPath.bucketRoot);
          const existing: Array<{ target: Target; full: string }> = [];
          for (const target of targets) {
            try {
              const full = await safeTargetPath(target, bucketRoot, false);
              existing.push({ target, full });
            } catch (error) {
              if ((error as { code?: string })?.code === "ENOENT") continue;
              throw error;
            }
          }
          for (const { target, full } of existing) {
            await fs.unlink(full);
            try {
              const sidecar = await safeTargetPath(
                { ...target, full: `${target.full}.meta.json` },
                bucketRoot,
                false,
              );
              await fs.unlink(sidecar);
            } catch (error) {
              if ((error as { code?: string })?.code !== "ENOENT") throw error;
            }
          }
          return { data: {}, error: null };
        } catch (error) {
          return { data: null, error: toStorageError(error) };
        }
      },
    };
  },
};
