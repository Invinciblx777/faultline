import { describe, expect, it } from "vitest";
import {
  checkScanTarget,
  findAllowlistMatch,
  hostPortAllowlisted,
  normalizeOrigin,
  normalizeTargetUrl,
  parseAllowlist,
  UrlValidationError,
} from "../src/url";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof UrlValidationError) return error.code;
    throw error;
  }
  return undefined;
}

describe("normalizeTargetUrl", () => {
  it("normalizes host case, drops fragments, and computes the origin", () => {
    const n = normalizeTargetUrl("  HTTPS://Example.COM/Path?q=1#section ");
    expect(n.url).toBe("https://example.com/Path?q=1");
    expect(n.origin).toBe("https://example.com");
    expect(n.port).toBe(443);
    expect(n.hostname).toBe("example.com");
  });

  it("rejects non-http schemes", () => {
    for (const input of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com", "data:text/html,hi", "chrome://settings", "ws://example.com"]) {
      expect(codeOf(() => normalizeTargetUrl(input)), input).toMatch(/unsupported_scheme|malformed/);
    }
  });

  it("rejects embedded credentials", () => {
    expect(codeOf(() => normalizeTargetUrl("https://user:pass@example.com/"))).toBe("credentials_not_allowed");
    expect(codeOf(() => normalizeTargetUrl("https://user@example.com/"))).toBe("credentials_not_allowed");
  });

  it("rejects empty, malformed, relative, and oversized input", () => {
    expect(codeOf(() => normalizeTargetUrl("   "))).toBe("empty");
    expect(codeOf(() => normalizeTargetUrl("example.com"))).toBe("malformed");
    expect(codeOf(() => normalizeTargetUrl("/relative"))).toBe("malformed");
    expect(codeOf(() => normalizeTargetUrl(`https://example.com/${"a".repeat(3000)}`))).toBe("too_long");
  });

  it("canonicalizes obfuscated IPv4 forms so later IP checks see the real address", () => {
    expect(normalizeTargetUrl("http://2130706433/").hostname).toBe("127.0.0.1");
    expect(normalizeTargetUrl("http://0x7f.1/").hostname).toBe("127.0.0.1");
    expect(normalizeTargetUrl("http://[::1]:8080/").hostname).toBe("::1");
  });
});

describe("normalizeOrigin", () => {
  it("accepts bare origins and strips the trailing slash", () => {
    expect(normalizeOrigin("https://Example.com/").url).toBe("https://example.com");
    expect(normalizeOrigin("http://localhost:4600").url).toBe("http://localhost:4600");
  });
  it("rejects paths and queries", () => {
    expect(codeOf(() => normalizeOrigin("https://example.com/app"))).toBe("not_an_origin");
    expect(codeOf(() => normalizeOrigin("https://example.com/?a=1"))).toBe("not_an_origin");
  });
});

describe("allowlist", () => {
  const entries = parseAllowlist("https://example.com, http://localhost:4600 https://*.example.org");

  it("parses exact and wildcard entries", () => {
    expect(entries.map((e) => e.source)).toEqual(["https://example.com", "http://localhost:4600", "https://*.example.org"]);
  });

  it("matches scheme, host, and port exactly", () => {
    expect(findAllowlistMatch("https://example.com/a/b", entries)).not.toBeNull();
    expect(findAllowlistMatch("http://example.com/", entries)).toBeNull(); // scheme differs
    expect(findAllowlistMatch("https://example.com:8443/", entries)).toBeNull(); // port differs
    expect(findAllowlistMatch("https://www.example.com/", entries)).toBeNull(); // no wildcard for example.com
    expect(findAllowlistMatch("https://example.com.evil.net/", entries)).toBeNull();
    expect(findAllowlistMatch("http://localhost:4600/page", entries)).not.toBeNull();
    expect(findAllowlistMatch("http://localhost:4601/page", entries)).toBeNull();
  });

  it("wildcards cover subdomains only, not the apex or lookalikes", () => {
    expect(findAllowlistMatch("https://app.example.org/", entries)).not.toBeNull();
    expect(findAllowlistMatch("https://a.b.example.org/", entries)).not.toBeNull();
    expect(findAllowlistMatch("https://example.org/", entries)).toBeNull();
    expect(findAllowlistMatch("https://badexample.org/", entries)).toBeNull();
  });

  it("rejects dangerous or malformed entries", () => {
    expect(() => parseAllowlist("https://*.com")).toThrow(UrlValidationError);
    expect(() => parseAllowlist("https://*.10.0.0.1")).toThrow(UrlValidationError);
    expect(() => parseAllowlist("https://ex*ample.com")).toThrow(UrlValidationError);
    expect(() => parseAllowlist("https://example.com/path")).toThrow(UrlValidationError);
    expect(() => parseAllowlist("file:///tmp")).toThrow(UrlValidationError);
  });

  it("matches host:port pairs for the egress guard", () => {
    expect(hostPortAllowlisted("localhost", 4600, entries)).toBe(true);
    expect(hostPortAllowlisted("LOCALHOST", 4600, entries)).toBe(true);
    expect(hostPortAllowlisted("localhost", 5432, entries)).toBe(false);
  });

  it("treats an empty allowlist as denying everything", () => {
    expect(parseAllowlist("")).toEqual([]);
    expect(findAllowlistMatch("https://example.com", [])).toBeNull();
  });
});

describe("checkScanTarget", () => {
  const entries = parseAllowlist("https://example.com");
  it("accepts same-origin allowlisted URLs", () => {
    const result = checkScanTarget("https://example.com/pricing", "https://example.com", entries);
    expect(result.ok).toBe(true);
  });
  it("rejects URLs outside the project origin", () => {
    const result = checkScanTarget("https://other.com/", "https://example.com", entries);
    expect(result).toMatchObject({ ok: false, code: "origin_mismatch" });
  });
  it("rejects a project origin that was removed from the allowlist", () => {
    const result = checkScanTarget("https://example.com/", "https://example.com", []);
    expect(result).toMatchObject({ ok: false, code: "not_allowlisted" });
  });
  it("reports validation errors", () => {
    expect(checkScanTarget("javascript:alert(1)", "https://example.com", entries)).toMatchObject({ ok: false });
  });
});
