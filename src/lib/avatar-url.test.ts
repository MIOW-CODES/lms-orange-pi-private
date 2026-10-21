import { describe, expect, it } from "bun:test";
import { avatarImageSource, isLocalAvatarUrl, localAvatarUrlOrNull } from "./avatar-url";

describe("local avatar URLs", () => {
  it("accepts the app's current same-origin avatar route", () => {
    const value = "/api/public/avatar?p=profile%2Favatar_123_0123456789abcdef.png";
    expect(isLocalAvatarUrl(value)).toBe(true);
    expect(localAvatarUrlOrNull(value)).toBe(value);
    expect(avatarImageSource(value)).toBe(value);
  });

  it("rejects external URLs and malformed or ambiguous local routes", () => {
    for (const value of [
      "https://avatars.example.invalid/avatar.svg?seed=synthetic",
      "//example.com/avatar.png",
      "javascript:alert(1)",
      "/api/public/avatar?p=",
      "/api/public/avatar?p=one&p=two",
      "/api/public/avatar?p=one&next=https%3A%2F%2Fexample.com",
      "/api/public/avatar?p=one#fragment",
      null,
      1,
    ]) {
      expect(isLocalAvatarUrl(value)).toBe(false);
      expect(localAvatarUrlOrNull(value)).toBeNull();
      expect(avatarImageSource(value)).toBeNull();
    }
  });

  it("allows a blob only when rendering a temporary upload preview", () => {
    expect(avatarImageSource("blob:https://akios.site/preview")).toBeNull();
    expect(avatarImageSource("blob:https://akios.site/preview", true)).toBe(
      "blob:https://akios.site/preview",
    );
  });
});
