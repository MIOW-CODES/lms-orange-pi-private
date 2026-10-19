import { describe, expect, it } from "bun:test";
import { readJsonBody } from "./read-json-body.server";

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

describe("readJsonBody", () => {
  it("accepts a valid JSON body at the byte limit", async () => {
    const body = '{"ok":true}';
    const result = await readJsonBody(jsonRequest(body), new TextEncoder().encode(body).byteLength);
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it("rejects a declared body over the limit before reading it", async () => {
    const request = new Request("http://localhost/test", {
      method: "POST",
      headers: { "Content-Length": "9" },
      body: "{}",
    });
    expect(await readJsonBody(request, 8)).toEqual({ ok: false, reason: "too_large" });
  });

  it("rejects streamed bodies that exceed the limit without Content-Length", async () => {
    expect(await readJsonBody(jsonRequest('{"x":"123456"}'), 8)).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("rejects malformed JSON and invalid UTF-8", async () => {
    expect(await readJsonBody(jsonRequest("{"), 8)).toEqual({ ok: false, reason: "invalid" });
    const invalidUtf8 = new Request("http://localhost/test", {
      method: "POST",
      body: new Uint8Array([0xff]),
    });
    expect(await readJsonBody(invalidUtf8, 8)).toEqual({ ok: false, reason: "invalid" });
  });

  it("rejects compressed request bodies instead of allowing an inflated-size bypass", async () => {
    const request = jsonRequest("{}", { "Content-Encoding": "gzip" });
    expect(await readJsonBody(request, 8)).toEqual({ ok: false, reason: "invalid" });
  });
});
