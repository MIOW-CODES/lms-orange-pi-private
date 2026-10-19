export type JsonBodyResult =
  { ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid" };

/** Read and parse JSON without allowing an unbounded request body into memory. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<JsonBodyResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }

  const contentEncoding = request.headers.get("content-encoding");
  if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
    return { ok: false, reason: "invalid" };
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) return { ok: false, reason: "invalid" };
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) return { ok: false, reason: "invalid" };
    if (declaredBytes > maxBytes) return { ok: false, reason: "too_large" };
  }

  if (!request.body) return { ok: false, reason: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "invalid" };
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
