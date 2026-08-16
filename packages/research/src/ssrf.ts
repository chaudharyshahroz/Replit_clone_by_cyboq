/**
 * SSRF protection for outbound fetches (spec §84, docs/MCP_SECURITY.md T5).
 *
 * Research fetches URLs that a search engine returned — which means an attacker
 * who can influence search results, or who plants a link in a page Reklu reads,
 * chooses the address. Without this guard, "research my competitors" becomes a
 * request to `http://169.254.169.254/latest/meta-data/iam/security-credentials/`
 * issued from inside the deployment's network.
 *
 * Two checks matter and both are required:
 *
 *  1. **Before connecting** — scheme, port, and hostname shape.
 *  2. **After DNS resolution** — the actual IP. Checking only the hostname is
 *     defeated by a domain that resolves to 127.0.0.1, and checking only once
 *     is defeated by DNS rebinding, so the resolved address is what gets
 *     connected to.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class BlockedUrlError extends Error {
  readonly reason: string;
  constructor(reason: string, url: string) {
    super(`Refused to fetch ${url}: ${reason}`);
    this.name = 'BlockedUrlError';
    this.reason = reason;
  }
}

/** Ports that are never legitimate targets for research fetching. */
const BLOCKED_PORTS = new Set([
  22, 23, 25, 110, 143, 445, 993, 995, // remote access and mail
  3306, 5432, 6379, 9200, 11211, 27017, // databases and caches
]);

/**
 * Private, loopback, link-local and other reserved ranges.
 *
 * 169.254.0.0/16 is called out explicitly because it covers the cloud metadata
 * endpoint at 169.254.169.254 — the single highest-value SSRF target.
 */
function isBlockedIPv4(ip: string): string | undefined {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return 'malformed IPv4 address';
  }
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return 'unspecified range 0.0.0.0/8';
  if (a === 10) return 'private range 10.0.0.0/8';
  if (a === 127) return 'loopback 127.0.0.0/8';
  if (a === 169 && b === 254) return 'link-local 169.254.0.0/16 (cloud metadata)';
  if (a === 172 && b >= 16 && b <= 31) return 'private range 172.16.0.0/12';
  if (a === 192 && b === 168) return 'private range 192.168.0.0/16';
  if (a === 192 && b === 0) return 'reserved range 192.0.0.0/24';
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-grade NAT 100.64.0.0/10';
  if (a >= 224) return 'multicast or reserved range';
  return undefined;
}

function isBlockedIPv6(ip: string): string | undefined {
  const normalized = ip.toLowerCase().replace(/^\[|\]$/g, '');

  if (normalized === '::' || normalized === '::0') return 'unspecified address';
  if (normalized === '::1') return 'IPv6 loopback';
  if (normalized.startsWith('fe80')) return 'IPv6 link-local';
  // fc00::/7 — unique local addresses.
  if (/^f[cd]/.test(normalized)) return 'IPv6 unique local address';
  if (normalized.startsWith('ff')) return 'IPv6 multicast';

  // IPv4-mapped (::ffff:127.0.0.1) must be checked as IPv4, or loopback slips
  // through in v6 clothing.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1]) {
    const blocked = isBlockedIPv4(mapped[1]);
    return blocked ? `IPv4-mapped ${blocked}` : undefined;
  }
  return undefined;
}

/** Is this literal IP address safe to connect to? */
export function checkIpAddress(ip: string): string | undefined {
  const version = isIP(ip);
  if (version === 4) return isBlockedIPv4(ip);
  if (version === 6) return isBlockedIPv6(ip);
  return 'not a valid IP address';
}

export interface UrlCheckOptions {
  /** Permit http and localhost. Development only; never set in production. */
  readonly allowInsecureLocal?: boolean;
}

/**
 * Validate a URL's shape. Does not resolve DNS — see {@link resolveSafeAddress}.
 */
export function checkUrl(rawUrl: string, options: UrlCheckOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError('not a valid URL', rawUrl);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    // Blocks file:, gopher:, ftp:, data: and friends.
    throw new BlockedUrlError(`unsupported scheme "${url.protocol}"`, rawUrl);
  }
  if (url.protocol === 'http:' && !options.allowInsecureLocal) {
    throw new BlockedUrlError('plaintext http is not permitted', rawUrl);
  }

  // Credentials in a URL are a redirect-laundering trick and never needed here.
  if (url.username || url.password) {
    throw new BlockedUrlError('URL contains embedded credentials', rawUrl);
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (BLOCKED_PORTS.has(port)) {
    throw new BlockedUrlError(`port ${port} is not permitted`, rawUrl);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname.length === 0) throw new BlockedUrlError('empty hostname', rawUrl);

  if (!options.allowInsecureLocal) {
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new BlockedUrlError('localhost is not permitted', rawUrl);
    }
    // .internal / .local / bare hostnames are internal service discovery.
    if (hostname.endsWith('.internal') || hostname.endsWith('.local')) {
      throw new BlockedUrlError('internal hostname suffix is not permitted', rawUrl);
    }
    if (!hostname.includes('.') && isIP(hostname) === 0) {
      throw new BlockedUrlError('bare hostname is not permitted', rawUrl);
    }
  }

  // A literal IP can be checked immediately, no DNS needed.
  if (isIP(hostname) !== 0) {
    const blocked = checkIpAddress(hostname);
    if (blocked && !options.allowInsecureLocal) {
      throw new BlockedUrlError(blocked, rawUrl);
    }
  }

  return url;
}

export interface SafeAddress {
  readonly url: URL;
  /** The resolved IP to connect to, pinned so DNS cannot change underneath. */
  readonly address: string;
  readonly family: 4 | 6;
}

/**
 * Validate, then resolve, then validate the resolved address.
 *
 * The resolved IP is returned so the caller can connect to *that address*
 * rather than resolving again — re-resolving is the window DNS rebinding
 * exploits.
 */
export async function resolveSafeAddress(
  rawUrl: string,
  options: UrlCheckOptions = {},
): Promise<SafeAddress> {
  const url = checkUrl(rawUrl, options);
  const hostname = url.hostname.toLowerCase();

  if (isIP(hostname) !== 0) {
    return {
      url,
      address: hostname,
      family: isIP(hostname) === 4 ? 4 : 6,
    };
  }

  let resolved: { address: string; family: number };
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new BlockedUrlError('hostname could not be resolved', rawUrl);
  }

  const blocked = checkIpAddress(resolved.address);
  if (blocked && !options.allowInsecureLocal) {
    // The common shape: attacker.com with an A record pointing at 127.0.0.1.
    throw new BlockedUrlError(`resolves to ${blocked}`, rawUrl);
  }

  return {
    url,
    address: resolved.address,
    family: resolved.family === 4 ? 4 : 6,
  };
}

/**
 * Validate a redirect target.
 *
 * A redirect is a fresh, server-chosen URL, so it gets the full check again.
 * Following redirects without re-checking is equivalent to having no guard.
 */
export async function checkRedirect(
  location: string,
  from: URL,
  options: UrlCheckOptions = {},
): Promise<SafeAddress> {
  const absolute = new URL(location, from).toString();
  return resolveSafeAddress(absolute, options);
}
