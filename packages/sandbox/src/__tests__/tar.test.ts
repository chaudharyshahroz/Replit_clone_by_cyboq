/**
 * The tar format, as Docker's API requires it.
 *
 * Docker moves files in and out of containers only as tar streams. A header
 * field written in the wrong base or the wrong column does not throw — Docker
 * accepts the archive and produces a container with missing or misnamed files,
 * which reads as a broken generation rather than a broken archive.
 */
import { describe, expect, it } from 'vitest';
import { createTar, extractTar } from '../tar';

describe('round trip', () => {
  it('returns exactly what was packed', () => {
    const files = [
      { path: 'package.json', content: '{"name":"demo"}' },
      { path: 'src/index.ts', content: 'export const x = 1;\n' },
    ];

    const extracted = extractTar(createTar(files));

    for (const file of files) {
      const found = extracted.find((entry) => entry.path === file.path);
      expect(found?.content, file.path).toBe(file.content);
    }
  });

  it('preserves content that is not ASCII', () => {
    const content = 'const greeting = "héllo — 世界";\n';
    const [file] = extractTar(createTar([{ path: 'a.ts', content }]));
    expect(file?.content).toBe(content);
  });

  it('handles an empty file without losing the entry', () => {
    const extracted = extractTar(createTar([{ path: 'empty.txt', content: '' }]));
    expect(extracted.find((entry) => entry.path === 'empty.txt')?.content).toBe('');
  });

  it('keeps files whose length is an exact multiple of the block size', () => {
    const content = 'x'.repeat(512);
    const [file] = extractTar(createTar([{ path: 'block.txt', content }]));
    expect(file?.content).toBe(content);
  });

  it('keeps every file when there are many', () => {
    const files = Array.from({ length: 40 }, (_, index) => ({
      path: `src/module-${index}.ts`,
      content: `export const value = ${index};`,
    }));
    const extracted = extractTar(createTar(files));
    expect(extracted.filter((entry) => entry.path.startsWith('src/'))).toHaveLength(40);
  });
});

describe('archive structure', () => {
  /* Docker creates parent directories only if the archive declares them. */
  it('declares the directories its files live in', () => {
    const archive = createTar([{ path: 'src/deep/nested/file.ts', content: 'x' }]);
    const text = archive.toString('binary');

    expect(text).toContain('src/');
    expect(text).toContain('src/deep/');
    expect(text).toContain('src/deep/nested/');
  });

  it('ends with the two zero blocks that mark the end of an archive', () => {
    const archive = createTar([{ path: 'a.txt', content: 'hi' }]);
    const tail = archive.subarray(archive.length - 1024);
    expect(tail.every((byte) => byte === 0)).toBe(true);
  });

  /*
   * The checksum is the sum of the header with its own field read as spaces.
   * Getting this wrong makes Docker reject the archive outright.
   */
  it('writes a header checksum that validates', () => {
    const archive = createTar([{ path: 'a.txt', content: 'hi' }]);
    const header = archive.subarray(0, 512);

    const stored = Number.parseInt(
      header.subarray(148, 156).toString('utf8').replace(/\0.*$/, '').trim(),
      8,
    );

    let sum = 0;
    for (let index = 0; index < 512; index++) {
      sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
    }

    expect(stored).toBe(sum);
  });

  it('marks a ustar archive so Docker reads the prefix field', () => {
    const archive = createTar([{ path: 'a.txt', content: 'hi' }]);
    expect(archive.subarray(257, 262).toString('utf8')).toBe('ustar');
  });

  /* Files are never written executable unless asked. */
  it('defaults to a non-executable mode', () => {
    const archive = createTar([{ path: 'a.txt', content: 'hi' }]);
    const header = archive.subarray(0, 512);
    const mode = header.subarray(100, 108).toString('utf8').replace(/\0.*$/, '').trim();
    expect(Number.parseInt(mode, 8) & 0o111).toBe(0);
  });
});

describe('long paths', () => {
  it('splits a long path across name and prefix rather than truncating it', () => {
    const path = `${'a'.repeat(60)}/${'b'.repeat(60)}/file.ts`;
    const [file] = extractTar(createTar([{ path, content: 'x' }]).subarray(0));
    const found = extractTar(createTar([{ path, content: 'x' }])).find(
      (entry) => entry.path === path,
    );

    expect(file).toBeDefined();
    expect(found?.path).toBe(path);
  });

  /*
   * A truncated path writes a file somewhere nobody expects, so a path that
   * cannot be represented is refused rather than silently mangled.
   */
  it('refuses a path that cannot be represented', () => {
    const path = `${'x'.repeat(200)}/${'y'.repeat(120)}.ts`;
    expect(() => createTar([{ path, content: 'x' }])).toThrow(/too long/i);
  });
});
