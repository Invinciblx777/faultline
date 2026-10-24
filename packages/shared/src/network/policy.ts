import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { hostPortAllowlisted, stripBrackets, type AllowlistEntry } from "../url";
import { classifyAddress, type AddressCategory } from "./ip";

export type DeploymentMode = "local" | "public";
export type SubresourcePolicy = "public" | "allowlist";

export interface EgressPolicy {
  mode: DeploymentMode;
  allowlist: AllowlistEntry[];
  /**
   * `public`: subresources may load from any public internet host on ports 80/443.
   * `allowlist`: every connection must target an allowlisted host.
   */
  subresourcePolicy: SubresourcePolicy;
}

export type EgressDenyReason =
  | "metadata_endpoint"
  | "private_destination"
  | "private_destination_public_mode"
  | "not_allowlisted"
  | "port_not_allowed"
  | "dns_failure"
  | "no_addresses"
  | "invalid_destination";

export type EgressDecision =
  | {
      allowed: true;
      /** First validated address. */
      address: string;
      family: 4 | 6;
      /** Every resolved address; all of them passed the policy, in resolver order. */
      addresses: Array<{ address: string; family: 4 | 6 }>;
      category: AddressCategory;
      allowlisted: boolean;
    }
  | { allowed: false; reason: EgressDenyReason; message: string; category?: AddressCategory; address?: string };

const STANDARD_PORTS = new Set([80, 443]);

/**
 * Decide whether a resolved destination may be contacted. Every resolved
 * address must pass: a hostname resolving to both public and private
 * addresses is refused, which defeats mixed-answer DNS tricks.
 */
export function evaluateResolvedDestination(
  hostname: string,
  port: number,
  addresses: Array<{ address: string; family: number }>,
  policy: EgressPolicy,
): EgressDecision {
  if (addresses.length === 0) {
    return { allowed: false, reason: "no_addresses", message: `${hostname} did not resolve to any address.` };
  }
  const allowlisted = hostPortAllowlisted(hostname, port, policy.allowlist);
  const allowedPorts = new Set([...STANDARD_PORTS, ...policy.allowlist.map((e) => e.port)]);

  if (policy.subresourcePolicy === "allowlist" && !allowlisted) {
    return { allowed: false, reason: "not_allowlisted", message: `${hostname}:${port} is not on the scan allowlist.` };
  }
  if (!allowlisted && !allowedPorts.has(port)) {
    return {
      allowed: false,
      reason: "port_not_allowed",
      message: `Port ${port} is only reachable when the destination is allowlisted.`,
    };
  }

  for (const { address } of addresses) {
    const category = classifyAddress(address);
    if (category === "invalid") {
      return { allowed: false, reason: "invalid_destination", message: `Unrecognized address ${address}.`, address };
    }
    if (category === "metadata") {
      return {
        allowed: false,
        reason: "metadata_endpoint",
        message: `${hostname} resolves to a cloud metadata endpoint (${address}). Always denied.`,
        category,
        address,
      };
    }
    if (category !== "public") {
      if (policy.mode === "public") {
        return {
          allowed: false,
          reason: "private_destination_public_mode",
          message: `${hostname} resolves to a non-public address (${address}, ${category}). Public deployments never reach non-public addresses.`,
          category,
          address,
        };
      }
      if (!allowlisted) {
        return {
          allowed: false,
          reason: "private_destination",
          message: `${hostname} resolves to a non-public address (${address}, ${category}) and is not explicitly allowlisted.`,
          category,
          address,
        };
      }
    }
  }
  const first = addresses[0]!;
  return {
    allowed: true,
    address: first.address,
    family: first.family === 6 ? 6 : 4,
    addresses: addresses.map((a) => ({ address: a.address, family: a.family === 6 ? (6 as const) : (4 as const) })),
    category: classifyAddress(first.address),
    allowlisted,
  };
}

export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const systemResolver: Resolver = async (hostname) => lookup(hostname, { all: true, verbatim: true });

/**
 * Resolve a hostname once and evaluate the answer. The caller must connect to
 * the returned `address` (not re-resolve the hostname) so the checked address
 * is the address actually contacted, which defeats DNS rebinding.
 */
export async function resolveAndEvaluate(
  rawHostname: string,
  port: number,
  policy: EgressPolicy,
  resolver: Resolver = systemResolver,
): Promise<EgressDecision> {
  const hostname = stripBrackets(rawHostname.toLowerCase());
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { allowed: false, reason: "invalid_destination", message: "Invalid host or port." };
  }
  if (isIP(hostname)) {
    return evaluateResolvedDestination(hostname, port, [{ address: hostname, family: isIP(hostname) }], policy);
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    return { allowed: false, reason: "dns_failure", message: `DNS lookup for ${hostname} failed (${code}).` };
  }
  return evaluateResolvedDestination(hostname, port, addresses, policy);
}
