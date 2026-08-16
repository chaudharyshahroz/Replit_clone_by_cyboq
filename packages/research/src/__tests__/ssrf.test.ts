import { describe, expect, it } from 'vitest';
import { BlockedUrlError, checkIpAddress, checkUrl, resolveSafeAddress } from '../ssrf';

describe('checkIpAddress', () => {
  // 169.254.169.254 is the single highest-value SSRF target in a cloud deploy.
  it('blocks the cloud metadata endpoint', () => {
    expect(checkIpAddress('169.254.169.254')).toMatch(/metadata/i);
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback range', '127.255.255.255'],
    ['private 10/8', '10.0.0.1'],
    ['private 172.16/12', '172.16.5.4'],
    ['private 172.31 edge', '172.31.255.255'],
    ['private 192.168/16', '192.168.1.1'],
    ['unspecified', '0.0.0.0'],
    ['link-local', '169.254.1.1'],
    ['CGNAT', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
  ])('blocks %s', (_label, ip) => {
    expect(checkIpAddress(ip)).toBeDefined();
  });

  it.each([
    ['public', '93.184.216.34'],
    ['just outside 172.16/12', '172.32.0.1'],
    ['just below 172.16/12', '172.15.255.255'],
    ['public 192.169', '192.169.0.1'],
  ])('permits %s', (_label, ip) => {
    expect(checkIpAddress(ip)).toBeUndefined();
  });

  it.each([
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique local', 'fc00::1'],
    ['IPv6 unique local fd', 'fd12:3456::1'],
    ['IPv6 multicast', 'ff02::1'],
  ])('blocks %s', (_label, ip) => {
    expect(checkIpAddress(ip)).toBeDefined();
  });

  // Loopback in v6 clothing.
  it('blocks IPv4-mapped loopback', () => {
    expect(checkIpAddress('::ffff:127.0.0.1')).toMatch(/loopback/i);
  });

  it('permits IPv4-mapped public addresses', () => {
    expect(checkIpAddress('::ffff:93.184.216.34')).toBeUndefined();
  });

  it('rejects nonsense', () => {
    expect(checkIpAddress('not-an-ip')).toBeDefined();
    expect(checkIpAddress('999.999.999.999')).toBeDefined();
  });
});

describe('checkUrl', () => {
  it('permits an ordinary https URL', () => {
    expect(checkUrl('https://example.com/article').hostname).toBe('example.com');
  });

  it.each([
    ['file', 'file:///etc/passwd'],
    ['gopher', 'gopher://example.com/'],
    ['data', 'data:text/html,<script>alert(1)</script>'],
    ['ftp', 'ftp://example.com/x'],
    ['javascript', 'javascript:alert(1)'],
  ])('blocks the %s scheme', (_label, url) => {
    expect(() => checkUrl(url)).toThrow(BlockedUrlError);
  });

  it('blocks plaintext http by default', () => {
    expect(() => checkUrl('http://example.com')).toThrow(/plaintext http/);
  });

  it('permits http when explicitly allowed for local development', () => {
    expect(() => checkUrl('http://localhost:3000', { allowInsecureLocal: true })).not.toThrow();
  });

  // Embedded credentials are a redirect-laundering trick.
  it('blocks embedded credentials', () => {
    expect(() => checkUrl('https://user:pass@example.com')).toThrow(/credentials/);
  });

  it.each([
    ['ssh', 'https://example.com:22/'],
    ['postgres', 'https://example.com:5432/'],
    ['redis', 'https://example.com:6379/'],
    ['smtp', 'https://example.com:25/'],
  ])('blocks the %s port', (_label, url) => {
    expect(() => checkUrl(url)).toThrow(/port/);
  });

  it('permits ordinary web ports', () => {
    expect(() => checkUrl('https://example.com:8443/')).not.toThrow();
  });

  it.each([
    ['localhost', 'https://localhost/'],
    ['localhost subdomain', 'https://api.localhost/'],
    ['.internal', 'https://vault.internal/'],
    ['.local', 'https://printer.local/'],
    ['bare hostname', 'https://intranet/'],
  ])('blocks %s', (_label, url) => {
    expect(() => checkUrl(url)).toThrow(BlockedUrlError);
  });

  it('blocks a literal private IP without needing DNS', () => {
    expect(() => checkUrl('https://169.254.169.254/latest/meta-data/')).toThrow(/metadata/i);
    expect(() => checkUrl('https://127.0.0.1/admin')).toThrow(/loopback/i);
    expect(() => checkUrl('https://10.0.0.5/internal')).toThrow(/private/i);
  });

  it('rejects malformed input', () => {
    expect(() => checkUrl('not a url')).toThrow(BlockedUrlError);
    expect(() => checkUrl('')).toThrow(BlockedUrlError);
  });
});

describe('resolveSafeAddress', () => {
  it('returns a pinned address for a literal public IP', async () => {
    const safe = await resolveSafeAddress('https://93.184.216.34/');
    expect(safe.address).toBe('93.184.216.34');
    expect(safe.family).toBe(4);
  });

  it('rejects a literal private IP', async () => {
    await expect(resolveSafeAddress('https://192.168.1.1/')).rejects.toThrow(BlockedUrlError);
  });

  // The canonical DNS-based bypass: a public-looking name pointing inward.
  // localhost is the one hostname guaranteed to resolve to loopback everywhere.
  it('rejects a hostname that resolves into a blocked range', async () => {
    await expect(
      // allowInsecureLocal is off, so the resolved 127.0.0.1 must be refused
      // even though the hostname itself parsed fine.
      resolveSafeAddress('https://localhost.localdomain/'),
    ).rejects.toThrow(BlockedUrlError);
  });

  it('rejects an unresolvable hostname', async () => {
    await expect(
      resolveSafeAddress('https://this-host-does-not-exist-reklu-test.example/'),
    ).rejects.toThrow(BlockedUrlError);
  });
});
