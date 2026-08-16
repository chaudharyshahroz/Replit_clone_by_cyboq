import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalDriver } from '../drivers/local';
import { assertSafeKey, buildKey, safeDisplayFilename, workspaceIdFromKey } from '../keys';
import { StorageError } from '../types';
import { sniffContentType, validateUpload } from '../validation';

const WORKSPACE = 'wsp_02gt0abcdefghjkmnpqrstvwx';
const FILE = 'fil_02gt0abcdefghjkmnpqrstvwx';

describe('buildKey', () => {
  it('builds a workspace-prefixed key', () => {
    expect(buildKey({ workspaceId: WORKSPACE, scope: 'uploads', fileId: FILE })).toBe(
      `${WORKSPACE}/uploads/${FILE}`,
    );
  });

  it('appends a server-chosen suffix', () => {
    expect(
      buildKey({ workspaceId: WORKSPACE, scope: 'media', fileId: FILE, suffix: 'thumb.webp' }),
    ).toBe(`${WORKSPACE}/media/${FILE}/thumb.webp`);
  });

  // The whole point of server-generated keys.
  it('refuses ids that are not well-formed Reklu ids', () => {
    expect(() => buildKey({ workspaceId: '../etc', scope: 'uploads', fileId: FILE })).toThrow(
      StorageError,
    );
    expect(() =>
      buildKey({ workspaceId: WORKSPACE, scope: 'uploads', fileId: '../../passwd' }),
    ).toThrow(StorageError);
  });

  it('strips traversal from a suffix', () => {
    expect(() =>
      buildKey({ workspaceId: WORKSPACE, scope: 'uploads', fileId: FILE, suffix: '../../x' }),
    ).toThrow(StorageError);
  });
});

describe('assertSafeKey', () => {
  it.each([
    ['traversal', 'wsp_x/../../etc/passwd'],
    ['absolute', '/etc/passwd'],
    ['double slash', 'a//b'],
    ['backslash', 'a\\b'],
    ['nul byte', 'a\u0000b'],
    ['control char', 'a\u001fb'],
    ['empty', ''],
    ['dot segment', 'a/./b'],
  ])('rejects %s', (_label, key) => {
    expect(() => assertSafeKey(key)).toThrow(StorageError);
  });

  it('accepts a well-formed key', () => {
    expect(() => assertSafeKey(`${WORKSPACE}/uploads/${FILE}/thumb.webp`)).not.toThrow();
  });
});

describe('workspaceIdFromKey', () => {
  it('extracts the owning workspace for an authorization check', () => {
    expect(workspaceIdFromKey(`${WORKSPACE}/uploads/${FILE}`)).toBe(WORKSPACE);
  });

  it('returns undefined when the prefix is not a workspace id', () => {
    expect(workspaceIdFromKey('uploads/x')).toBeUndefined();
  });
});

describe('safeDisplayFilename', () => {
  it('strips directory components', () => {
    expect(safeDisplayFilename('../../etc/passwd')).toBe('passwd');
    expect(safeDisplayFilename('C:\\Windows\\system32\\x.dll')).toBe('x.dll');
  });

  // A quote would break out of the Content-Disposition filename="..." field.
  it('removes quotes and control characters', () => {
    expect(safeDisplayFilename('a"b\u0000c.txt')).toBe('abc.txt');
  });

  it('never returns empty', () => {
    expect(safeDisplayFilename('')).toBe('download');
    expect(safeDisplayFilename('///')).toBe('download');
  });
});

describe('sniffContentType', () => {
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

  it('detects real types from magic bytes', () => {
    expect(sniffContentType(pdf).detected.mimeType).toBe('application/pdf');
    expect(sniffContentType(png).detected.mimeType).toBe('image/png');
    expect(sniffContentType(jpeg).detected.mimeType).toBe('image/jpeg');
  });

  it('detects webp only with the RIFF+WEBP pair', () => {
    const webp = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([0x57, 0x45, 0x42, 0x50]),
    ]);
    expect(sniffContentType(webp).detected.mimeType).toBe('image/webp');
  });

  it('treats plain text as text/plain', () => {
    expect(sniffContentType(Buffer.from('hello world', 'utf8')).detected.mimeType).toBe(
      'text/plain',
    );
  });

  /**
   * The attack this whole module exists to stop: HTML uploaded as "image/png".
   * If the declared type were trusted and later served inline, it would be
   * stored XSS.
   */
  it('does not trust a declared type that contradicts the bytes', () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8');
    const result = sniffContentType(html, 'image/png');

    expect(result.detected.mimeType).not.toBe('image/png');
    expect(result.mismatch).toBe(true);
    expect(result.renderRisk).toBe(true);
  });

  it('flags svg as a render risk', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
    expect(sniffContentType(svg).renderRisk).toBe(true);
  });

  it('reports no mismatch when the claim matches', () => {
    expect(sniffContentType(pdf, 'application/pdf').mismatch).toBe(false);
  });

  it('rejects unrecognised binary rather than guessing', () => {
    const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x13, 0x37]);
    expect(() => sniffContentType(binary)).toThrow(StorageError);
  });

  it('identifies OOXML by its zip entry names', () => {
    const docx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('.....word/document.xml', 'latin1'),
    ]);
    expect(sniffContentType(docx).detected.extension).toBe('docx');

    const xlsx = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('.....xl/workbook.xml', 'latin1'),
    ]);
    expect(sniffContentType(xlsx).detected.extension).toBe('xlsx');
  });
});

describe('validateUpload', () => {
  const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]);

  it('accepts a valid file under the limit', () => {
    const result = validateUpload({
      buffer: pdf,
      filename: 'report.pdf',
      maxBytes: 1_000,
    });
    expect(result.contentType).toBe('application/pdf');
    expect(result.forceDownload).toBe(false);
  });

  it('rejects an empty file', () => {
    expect(() =>
      validateUpload({ buffer: Buffer.alloc(0), filename: 'x', maxBytes: 100 }),
    ).toThrow(/empty/i);
  });

  it('rejects a file over the limit with a readable message', () => {
    expect(() =>
      validateUpload({ buffer: Buffer.alloc(2_000_000), filename: 'x', maxBytes: 1_048_576 }),
    ).toThrow(/over the 1MB limit/);
  });

  it('forces download for markup-shaped content', () => {
    const html = Buffer.from('<html><body>hi</body></html>', 'utf8');
    expect(validateUpload({ buffer: html, filename: 'x.html', maxBytes: 1_000 }).forceDownload).toBe(
      true,
    );
  });
});

describe('local driver', () => {
  const roots: string[] = [];
  const makeDriver = async () => {
    const root = await mkdtemp(join(tmpdir(), 'reklu-storage-'));
    roots.push(root);
    return createLocalDriver({ root, appUrl: 'http://localhost:3000' });
  };

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('round-trips an object with its content type', async () => {
    const driver = await makeDriver();
    const key = buildKey({ workspaceId: WORKSPACE, scope: 'uploads', fileId: FILE });

    const put = await driver.put({
      key,
      body: Buffer.from('hello reklu'),
      contentType: 'text/plain',
      filename: 'greeting.txt',
    });
    expect(put.size).toBe(11);
    expect(put.checksum).toMatch(/^[0-9a-f]{64}$/);

    const got = await driver.get(key);
    expect(got.body.toString()).toBe('hello reklu');
    expect(got.contentType).toBe('text/plain');
  });

  it('reports existence and deletes', async () => {
    const driver = await makeDriver();
    const key = buildKey({ workspaceId: WORKSPACE, scope: 'uploads', fileId: FILE });

    expect(await driver.exists(key)).toBe(false);
    await driver.put({ key, body: Buffer.from('x'), contentType: 'text/plain' });
    expect(await driver.exists(key)).toBe(true);

    await driver.delete(key);
    expect(await driver.exists(key)).toBe(false);
  });

  it('throws NOT_FOUND for a missing object', async () => {
    const driver = await makeDriver();
    await expect(
      driver.get(buildKey({ workspaceId: WORKSPACE, scope: 'uploads', fileId: FILE })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // Defence in depth: even if a malformed key reached the driver, the resolved
  // path is re-checked against the root.
  it('refuses to read outside its root', async () => {
    const driver = await makeDriver();
    await expect(driver.get('../../../etc/passwd')).rejects.toThrow(StorageError);
    await expect(driver.exists('../../secrets')).resolves.toBe(false);
  });

  it('declares itself non-durable so production rejects it', async () => {
    const driver = await makeDriver();
    expect(driver.isDurable).toBe(false);
  });

  it('builds an authorized app URL rather than a public one', async () => {
    const driver = await makeDriver();
    const key = buildKey({ workspaceId: WORKSPACE, scope: 'uploads', fileId: FILE });
    const url = await driver.signedUrl({ key, downloadFilename: 'my report.pdf' });
    expect(url).toContain('/api/files/');
    expect(url).toContain('download=');
  });
});

describe('resolveLocalStorageRoot', () => {
  it('anchors a relative path at the monorepo root, not the process cwd', async () => {
    const { resolveLocalStorageRoot } = await import('../root');
    const fromRepoRoot = resolveLocalStorageRoot('./.storage');

    // The bug this guards: web (cwd apps/web) and worker (cwd apps/worker)
    // resolving './.storage' to two different directories.
    expect(fromRepoRoot.endsWith('/.storage')).toBe(true);
    expect(fromRepoRoot).not.toContain('/apps/');
    expect(fromRepoRoot.startsWith('/')).toBe(true);
  });

  it('leaves an absolute path alone', async () => {
    const { resolveLocalStorageRoot } = await import('../root');
    expect(resolveLocalStorageRoot('/var/reklu/storage')).toBe('/var/reklu/storage');
  });
});
