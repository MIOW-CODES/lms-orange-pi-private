import { describe, expect, it } from "bun:test";
import {
  authClientIp,
  authRequestRateLimited,
  AUTH_REQUEST_RATE_LIMIT,
  AUTH_REQUEST_RATE_LIMIT_MAX_CLIENTS,
  AUTH_REQUEST_WINDOW_MS,
} from "./auth-request-rate-limit.server";

function makeRequest(ip: string, forwardedFor?: string): Request {
  const headers = new Headers({ "x-real-ip": ip });
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  return new Request("http://localhost/auth", { headers });
}

describe("public authentication request limiter", () => {
  it("blocks only after the per-source threshold and keeps sources independent", () => {
    const first = makeRequest("192.0.2.121");
    const second = makeRequest("192.0.2.122");
    for (let attempt = 0; attempt < AUTH_REQUEST_RATE_LIMIT; attempt++) {
      expect(authRequestRateLimited(first)).toBe(false);
    }
    expect(authRequestRateLimited(first)).toBe(true);
    expect(authRequestRateLimited(second)).toBe(false);
  });

  it("starts a fresh window after one minute", () => {
    const request = makeRequest("192.0.2.123");
    const start = Date.now();
    for (let attempt = 0; attempt <= AUTH_REQUEST_RATE_LIMIT; attempt++) {
      authRequestRateLimited(request, start);
    }
    expect(authRequestRateLimited(request, start + AUTH_REQUEST_WINDOW_MS)).toBe(false);
  });

  it("uses only a validated NPM X-Real-IP and ignores X-Forwarded-For", () => {
    expect(authClientIp(makeRequest("2001:db8::1", "192.0.2.200"))).toBe("2001:db8::1");
    expect(authClientIp(makeRequest("forged", "192.0.2.201"))).toBe("unknown");
    expect(
      authClientIp(
        new Request("http://localhost/auth", {
          headers: { "x-forwarded-for": "192.0.2.202" },
        }),
      ),
    ).toBe("unknown");
  });

  it("bounds retained client state and evicts the least-recently-used source", () => {
    const oldest = makeRequest("198.51.100.1");
    for (let attempt = 0; attempt <= AUTH_REQUEST_RATE_LIMIT; attempt++) {
      authRequestRateLimited(oldest);
    }

    for (let index = 0; index < AUTH_REQUEST_RATE_LIMIT_MAX_CLIENTS + 1; index++) {
      authRequestRateLimited(makeRequest(`203.0.${Math.floor(index / 250)}.${(index % 250) + 1}`));
    }

    expect(authRequestRateLimited(oldest)).toBe(false);
  });
});
