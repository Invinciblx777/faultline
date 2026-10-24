import { BlockList, isIP } from "node:net";

/**
 * Classification of IP addresses for server-side request forgery protection.
 * Anything that is not `public` is treated as a sensitive destination.
 */
export type AddressCategory =
  | "public"
  | "loopback"
  | "private"
  | "link_local"
  | "metadata"
  | "unspecified"
  | "carrier_grade_nat"
  | "multicast"
  | "reserved"
  | "invalid";

interface Range {
  network: string;
  prefix: number;
  category: Exclude<AddressCategory, "public" | "invalid">;
}

// Most specific first: metadata endpoints sit inside link-local / ULA ranges.
const IPV4_RANGES: Range[] = [
  { network: "169.254.169.254", prefix: 32, category: "metadata" }, // AWS, GCP, Azure, OpenStack metadata
  { network: "169.254.170.2", prefix: 32, category: "metadata" }, // AWS ECS task metadata
  { network: "100.100.100.200", prefix: 32, category: "metadata" }, // Alibaba Cloud metadata
  { network: "0.0.0.0", prefix: 8, category: "unspecified" },
  { network: "10.0.0.0", prefix: 8, category: "private" },
  { network: "100.64.0.0", prefix: 10, category: "carrier_grade_nat" },
  { network: "127.0.0.0", prefix: 8, category: "loopback" },
  { network: "169.254.0.0", prefix: 16, category: "link_local" },
  { network: "172.16.0.0", prefix: 12, category: "private" },
  { network: "192.0.0.0", prefix: 24, category: "reserved" },
  { network: "192.0.2.0", prefix: 24, category: "reserved" },
  { network: "192.88.99.0", prefix: 24, category: "reserved" },
  { network: "192.168.0.0", prefix: 16, category: "private" },
  { network: "198.18.0.0", prefix: 15, category: "reserved" },
  { network: "198.51.100.0", prefix: 24, category: "reserved" },
  { network: "203.0.113.0", prefix: 24, category: "reserved" },
  { network: "224.0.0.0", prefix: 4, category: "multicast" },
  { network: "240.0.0.0", prefix: 4, category: "reserved" },
];

const IPV6_RANGES: Range[] = [
  { network: "fd00:ec2::254", prefix: 128, category: "metadata" }, // AWS IPv6 metadata
  { network: "::", prefix: 128, category: "unspecified" },
  { network: "::1", prefix: 128, category: "loopback" },
  { network: "100::", prefix: 64, category: "reserved" }, // discard-only
  { network: "2001::", prefix: 32, category: "reserved" }, // Teredo
  { network: "2001:db8::", prefix: 32, category: "reserved" }, // documentation
  { network: "2001:10::", prefix: 28, category: "reserved" }, // ORCHID
  { network: "fc00::", prefix: 7, category: "private" }, // unique local
  { network: "fe80::", prefix: 10, category: "link_local" },
  { network: "fec0::", prefix: 10, category: "reserved" }, // deprecated site-local
  { network: "ff00::", prefix: 8, category: "multicast" },
];

function buildLists(ranges: Range[], family: "ipv4" | "ipv6") {
  return ranges.map((range) => {
    const list = new BlockList();
    list.addSubnet(range.network, range.prefix, family);
    return { list, category: range.category };
  });
}

const V4_LISTS = buildLists(IPV4_RANGES, "ipv4");
const V6_LISTS = buildLists(IPV6_RANGES, "ipv6");

function expandIpv6(address: string): number[] | null {
  // Returns the 8 hextets of an IPv6 address, handling `::` and embedded IPv4.
  let addr = address.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  if (isIP(addr) !== 6) return null;
  // Rewrite a dotted IPv4 tail (e.g. ::ffff:1.2.3.4) as two hextets.
  const lastColon = addr.lastIndexOf(":");
  const maybeV4 = addr.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const o = maybeV4.split(".").map(Number) as [number, number, number, number];
    addr = `${addr.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const parts = addr.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const rest = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0) return null;
  const hextets = [...head.map((h) => parseInt(h, 16)), ...Array<number>(fill).fill(0), ...rest.map((h) => parseInt(h, 16))];
  if (hextets.length !== 8 || hextets.some((h) => Number.isNaN(h) || h < 0 || h > 0xffff)) return null;
  return hextets;
}

function hextetsToV4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * If an IPv6 address embeds an IPv4 address that a router could translate
 * (IPv4-mapped, IPv4-compatible, NAT64, 6to4), return that IPv4 address.
 */
export function embeddedIpv4(address: string): string | null {
  const h = expandIpv6(address);
  if (!h) return null;
  const [a, b, c, d, e, f, g, i] = h as [number, number, number, number, number, number, number, number];
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated compatible)
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0xffff || f === 0) && !(f === 0 && g === 0)) {
    return hextetsToV4(g, i);
  }
  // 64:ff9b::/96 well-known NAT64 prefix and 64:ff9b:1::/48 local-use NAT64
  if (a === 0x64 && b === 0xff9b) return hextetsToV4(g, i);
  // 2002::/16 6to4: IPv4 in hextets 2-3
  if (a === 0x2002) return hextetsToV4(b, c);
  return null;
}

export function classifyAddress(address: string): AddressCategory {
  const clean = address.startsWith("[") && address.endsWith("]") ? address.slice(1, -1) : address;
  const family = isIP(clean.split("%")[0] ?? "");
  if (family === 4) {
    for (const { list, category } of V4_LISTS) {
      if (list.check(clean, "ipv4")) return category;
    }
    return "public";
  }
  if (family === 6) {
    const bare = clean.split("%")[0] ?? clean;
    const v4 = embeddedIpv4(bare);
    if (v4) {
      const inner = classifyAddress(v4);
      // An embedded public IPv4 inside 6to4/NAT64 still routes through translation; treat as reserved
      // unless it's IPv4-mapped, which the OS connects to directly as IPv4.
      return inner;
    }
    for (const { list, category } of V6_LISTS) {
      if (list.check(bare, "ipv6")) return category;
    }
    // Only global unicast (2000::/3) is public.
    const first = expandIpv6(bare)?.[0];
    if (first === undefined) return "invalid";
    return first >= 0x2000 && first <= 0x3fff ? "public" : "reserved";
  }
  return "invalid";
}

export function isPublicAddress(address: string): boolean {
  return classifyAddress(address) === "public";
}
