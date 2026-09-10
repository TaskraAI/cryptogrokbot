import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, totpAt, verifyTotp } from "../apps/agent/src/totp.ts";

describe("totp", () => {
  it("encodes and decodes RFC 4648 base32 without requiring padding", () => {
    expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6");
    expect(base32Decode("MZXW6").toString("utf8")).toBe("foo");
    expect(base32Decode("MZXW6===").toString("utf8")).toBe("foo");
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("mzxw6ytboi").toString("utf8")).toBe("foobar");
  });

  it("totpAt matches RFC 6238 SHA1 6-digit vectors", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpAt(secret, 59 * 1000)).toBe("287082");
    expect(totpAt(secret, 1_111_111_109 * 1000)).toBe("081804");
  });

  it("verifies the current window and rejects junk", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = totpAt(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, code, now + 29_000)).toBe(true);
    expect(verifyTotp(secret, "000000", now)).toBe(false);
    expect(verifyTotp(secret, "abc", now)).toBe(false);
  });
});
