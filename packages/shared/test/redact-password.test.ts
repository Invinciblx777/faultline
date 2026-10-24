import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, validatePasswordStrength } from "../src/password";
import { redactText, redactUrl } from "../src/redact";

describe("redactUrl", () => {
  it("masks sensitive query parameters and keeps harmless ones", () => {
    const out = redactUrl("https://api.test/v1?page=2&access_token=abc123&api_key=k&q=shoes");
    expect(out).toContain("page=2");
    expect(out).toContain("q=shoes");
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("api_key=k&");
  });
  it("removes embedded credentials and parameterized fragments", () => {
    const out = redactUrl("https://user:pw@site.test/cb#access_token=secret&x=1");
    expect(out).not.toContain("pw");
    expect(out).not.toContain("secret");
  });
  it("summarizes data URLs instead of storing their payload", () => {
    expect(redactUrl(`data:image/png;base64,${"A".repeat(5000)}`)).toBe("data:image/png;base64,…");
  });
});

describe("redactText", () => {
  it("masks bearer tokens, JWTs, and key=value secrets", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const out = redactText(`Failed with Authorization: Bearer abcdefghijklmnop token=${jwt} password: hunter22`);
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).not.toContain(jwt);
    expect(out).not.toContain("hunter22");
  });
  it("truncates long messages", () => {
    expect(redactText("x".repeat(5000)).length).toBeLessThanOrEqual(2000);
  });
});

describe("password hashing", () => {
  it("hashes with scrypt and verifies", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password entirely", hash)).toBe(false);
  });
  it("produces unique salts", async () => {
    const a = await hashPassword("same password 123");
    const b = await hashPassword("same password 123");
    expect(a).not.toBe(b);
  });
  it("rejects weak passwords and malformed hashes", async () => {
    expect(validatePasswordStrength("short")).not.toBeNull();
    await expect(hashPassword("short")).rejects.toThrow();
    expect(await verifyPassword("anything at all", "plaintext")).toBe(false);
    expect(await verifyPassword("anything at all", "scrypt$99999999$8$1$a$b")).toBe(false);
  });
});
