import dns from "node:dns/promises";
import net from "node:net";
import { isIPv4, isIPv6 } from "node:net";
import { config } from "./config.js";

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  resolvedIp?: string;
  normalizedUrl?: string;
}

// A tiny, dependency-free CIDR containment check for both IPv4 and IPv6.
// Deliberately self-contained (no third-party parser) so this safety check
// has the smallest possible trusted surface.
function ipToBigInt(ip: string): { value: bigint; bits: number } | null {
  if (isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    const value = parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n);
    return { value, bits: 32 };
  }
  if (isIPv6(ip)) {
    const full = expandIPv6(ip);
    if (!full) return null;
    const value = full.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n);
    return { value, bits: 128 };
  }
  return null;
}

function expandIPv6(ip: string): number[] | null {
  // Handle IPv4-mapped IPv6 addresses like ::ffff:127.0.0.1.
  const v4Match = ip.match(/^(.*):(\d+\.\d+\.\d+\.\d+)$/);
  let addr = ip;
  let tail: number[] = [];
  if (v4Match) {
    const [a, b, c, d] = v4Match[2].split(".").map(Number);
    if ([a, b, c, d].some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    tail = [(a << 8) | b, (c << 8) | d];
    addr = v4Match[1] + ":0:0";
  }
  const parts = addr.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":").filter((s) => s.length > 0) : [];
  const tailParts = parts.length === 2 && parts[1] ? parts[1].split(":").filter((s) => s.length > 0) : [];
  let groups: string[];
  if (parts.length === 2) {
    const missing = 8 - (head.length + tailParts.length);
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tailParts];
  } else {
    groups = head;
    if (groups.length !== 8) return null;
  }
  if (v4Match) {
    groups = groups.slice(0, 6);
    while (groups.length < 6) groups.push("0");
  }
  const nums = groups.map((g) => parseInt(g || "0", 16));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return v4Match ? [...nums, ...tail] : nums;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [rangeIp, prefixStr] = cidr.split("/");
  const parsedIp = ipToBigInt(ip);
  const parsedRange = ipToBigInt(rangeIp);
  if (!parsedIp || !parsedRange) return false;
  if (parsedIp.bits !== parsedRange.bits) return false;
  const prefix = Number(prefixStr ?? parsedIp.bits);
  const totalBits = parsedIp.bits;
  if (prefix < 0 || prefix > totalBits) return false;
  if (prefix === 0) return true;
  const shift = BigInt(totalBits - prefix);
  return (parsedIp.value >> shift) === (parsedRange.value >> shift);
}

export function isIpAllowed(ip: string, allowedCidrs: string[]): boolean {
  return allowedCidrs.some((cidr) => ipInCidr(ip, cidr));
}

/**
 * Validates that `addressInput` (a raw URL or host[:port] string) points to a
 * local/private address. Resolves DNS itself and checks the *resolved* IP
 * against the allowlist, rather than trusting the hostname string, so a
 * hostname engineered to resolve differently at request time (DNS rebinding)
 * cannot slip past a check that only looked at the literal string.
 *
 * This must be called again immediately before any external system (a
 * Daytona sandbox, a Nosana job) actually dispatches traffic — not only once
 * at the start of a run — since the earlier resolution can go stale.
 */
export async function validateLocalTarget(
  addressInput: string,
  allowedCidrs: string[] = config.defaultAllowedCidrs
): Promise<ValidationResult> {
  let url: URL;
  try {
    url = new URL(addressInput.includes("://") ? addressInput : `http://${addressInput}`);
  } catch {
    return { ok: false, reason: "Could not parse the address as a URL or host." };
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, reason: `Unsupported protocol "${url.protocol}" — only http/https are allowed.` };
  }

  const hostname = url.hostname;

  // A literal IP in the URL still goes through the same allowlist check.
  if (net.isIP(hostname)) {
    if (!isIpAllowed(hostname, allowedCidrs)) {
      return { ok: false, reason: `Address resolves to ${hostname}, which is not in an allowed local/private range.` };
    }
    return { ok: true, resolvedIp: hostname, normalizedUrl: url.toString() };
  }

  let resolvedIps: string[];
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    resolvedIps = records.map((r) => r.address);
  } catch (err) {
    return { ok: false, reason: `DNS resolution failed for "${hostname}": ${(err as Error).message}` };
  }

  if (resolvedIps.length === 0) {
    return { ok: false, reason: `"${hostname}" did not resolve to any address.` };
  }

  // Every resolved address must be local — a hostname that resolves to a mix
  // of a private and a public IP is rejected outright rather than picked
  // optimistically, since a caller could otherwise be routed to the public one.
  const disallowed = resolvedIps.filter((ip) => !isIpAllowed(ip, allowedCidrs));
  if (disallowed.length > 0) {
    return {
      ok: false,
      reason: `"${hostname}" resolves to ${disallowed.join(", ")}, which is not in an allowed local/private range. Only local/private targets may be tested (external domains are out of scope for legal-safety reasons).`,
    };
  }

  return { ok: true, resolvedIp: resolvedIps[0], normalizedUrl: url.toString() };
}
