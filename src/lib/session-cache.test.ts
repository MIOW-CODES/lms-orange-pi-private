import { describe, expect, it } from "bun:test";
import { sessionCacheIdentity, updateSessionCacheIdentity } from "./session-cache";

describe("account-scoped query cache identity", () => {
  it("clears cached data when the profile, role, or signed-in state changes", () => {
    let clearCount = 0;
    const clearQueryCache = () => {
      clearCount += 1;
    };
    let identity = sessionCacheIdentity({ id: "student-a", role: "student" });

    identity = updateSessionCacheIdentity(
      identity,
      { id: "student-a", role: "student" },
      clearQueryCache,
    );
    expect(clearCount).toBe(0);

    identity = updateSessionCacheIdentity(
      identity,
      { id: "student-b", role: "student" },
      clearQueryCache,
    );
    expect(clearCount).toBe(1);

    identity = updateSessionCacheIdentity(
      identity,
      { id: "student-b", role: "teacher" },
      clearQueryCache,
    );
    expect(clearCount).toBe(2);

    identity = updateSessionCacheIdentity(identity, null, clearQueryCache);
    expect(clearCount).toBe(3);
    expect(identity).toBeNull();

    identity = updateSessionCacheIdentity(identity, null, clearQueryCache);
    expect(clearCount).toBe(3);
  });
});
