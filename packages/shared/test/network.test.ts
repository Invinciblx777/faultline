import { describe, expect, it } from "vitest";
import { classifyAddress, embeddedIpv4, evaluateResolvedDestination, resolveAndEvaluate, type EgressPolicy } from "../src/network";
import { parseAllowlist } from "../src/url";

describe("classifyAddress", () => {
  it.each([
    ["8.8.8.8", "public"],
    ["93.184.215.14", "public"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["172.32.0.1", "public"],
    ["192.168.1.1", "private"],
    ["169.254.10.10", "link_local"],
    ["169.254.169.254", "metadata"],
    ["169.254.170.2", "metadata"],
    ["100.100.100.200", "metadata"],
    ["100.64.0.1", "carrier_grade_nat"],
    ["0.0.0.0", "unspecified"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["198.18.0.1", "reserved"],
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fe80::1", "link_local"],
    ["fc00::1", "private"],
    ["fd12:3456::1", "private"],
    ["fd00:ec2::254", "metadata"],
    ["ff02::1", "multicast"],
    ["2001:4860:4860::8888", "public"],
    ["2001:db8::1", "reserved"],
    ["::ffff:127.0.0.1", "loopback"],
    ["::ffff:7f00:1", "loopback"],
    ["::ffff:169.254.169.254", "metadata"],
    ["::ffff:8.8.8.8", "public"],
    ["64:ff9b::a00:1", "private"],
    ["2002:7f00:1::", "loopback"],
    ["not-an-ip", "invalid"],
  ])("%s is %s", (address, category) => {
    expect(classifyAddress(address)).toBe(category);
  });

  it("extracts embedded IPv4 addresses", () => {
    expect(embeddedIpv4("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(embeddedIpv4("64:ff9b::0a00:0001")).toBe("10.0.0.1");
    expect(embeddedIpv4("2001:4860::1")).toBeNull();
  });
});

const allowlist = parseAllowlist("http://localhost:4600, https://example.com");
const local: EgressPolicy = { mode: "local", allowlist, subresourcePolicy: "public" };
const pub: EgressPolicy = { mode: "public", allowlist, subresourcePolicy: "public" };

describe("evaluateResolvedDestination", () => {
  it("allows public destinations on standard ports", () => {
    expect(evaluateResolvedDestination("cdn.test", 443, [{ address: "8.8.8.8", family: 4 }], local).allowed).toBe(true);
  });

  it("refuses non-standard ports unless the host is allowlisted", () => {
    expect(evaluateResolvedDestination("cdn.test", 8443, [{ address: "8.8.8.8", family: 4 }], local)).toMatchObject({
      allowed: false,
      reason: "port_not_allowed",
    });
  });

  it("allows an explicitly allowlisted private target only in local mode", () => {
    const addrs = [{ address: "127.0.0.1", family: 4 }];
    expect(evaluateResolvedDestination("localhost", 4600, addrs, local).allowed).toBe(true);
    expect(evaluateResolvedDestination("localhost", 4600, addrs, pub)).toMatchObject({
      allowed: false,
      reason: "private_destination_public_mode",
    });
  });

  it("refuses private destinations that are not allowlisted, even on allowlisted ports", () => {
    expect(evaluateResolvedDestination("internal.test", 80, [{ address: "10.0.0.5", family: 4 }], local)).toMatchObject({
      allowed: false,
      reason: "private_destination",
    });
    expect(evaluateResolvedDestination("localhost", 5432, [{ address: "127.0.0.1", family: 4 }], local)).toMatchObject({
      allowed: false,
    });
  });

  it("always refuses metadata endpoints, even when allowlisted", () => {
    const policy: EgressPolicy = { ...local, allowlist: parseAllowlist("http://169.254.169.254") };
    expect(evaluateResolvedDestination("169.254.169.254", 80, [{ address: "169.254.169.254", family: 4 }], policy)).toMatchObject({
      allowed: false,
      reason: "metadata_endpoint",
    });
  });

  it("refuses mixed public/private DNS answers", () => {
    const addrs = [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    expect(evaluateResolvedDestination("rebind.test", 443, addrs, local).allowed).toBe(false);
  });

  it("allowlist-only subresource policy refuses unlisted public hosts", () => {
    const strict: EgressPolicy = { ...local, subresourcePolicy: "allowlist" };
    expect(evaluateResolvedDestination("cdn.test", 443, [{ address: "8.8.8.8", family: 4 }], strict)).toMatchObject({
      allowed: false,
      reason: "not_allowlisted",
    });
    expect(evaluateResolvedDestination("example.com", 443, [{ address: "8.8.8.8", family: 4 }], strict).allowed).toBe(true);
  });
});

describe("resolveAndEvaluate", () => {
  it("evaluates IP literals without DNS", async () => {
    const decision = await resolveAndEvaluate("[::1]", 80, local, async () => {
      throw new Error("resolver must not be called");
    });
    expect(decision).toMatchObject({ allowed: false, reason: "private_destination" });
  });

  it("uses the injected resolver result as the address to contact", async () => {
    const decision = await resolveAndEvaluate("example.com", 443, local, async () => [{ address: "93.184.215.14", family: 4 }]);
    expect(decision).toMatchObject({ allowed: true, address: "93.184.215.14" });
  });

  it("reports DNS failures", async () => {
    const decision = await resolveAndEvaluate("nope.invalid", 443, local, async () => {
      throw Object.assign(new Error("not found"), { code: "ENOTFOUND" });
    });
    expect(decision).toMatchObject({ allowed: false, reason: "dns_failure" });
  });

  it("rejects invalid ports", async () => {
    expect(await resolveAndEvaluate("example.com", 0, local)).toMatchObject({ allowed: false, reason: "invalid_destination" });
  });
});
