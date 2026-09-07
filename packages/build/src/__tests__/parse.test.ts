import { describe, expect, it } from 'vitest';
import { parseGeneratedFiles } from '../parse';

const fence = (info: string, body: string) => '```' + info + '\n' + body + '\n```';

describe('parseGeneratedFiles — recognised shapes', () => {
  it('accepts a path comment as the first line inside a fence', () => {
    const result = parseGeneratedFiles(
      ['```json', '// package.json', '{ "name": "reklu-site" }', '```'].join('\n'),
    );

    expect(result.files).toEqual([
      expect.objectContaining({ path: 'package.json', content: '{ "name": "reklu-site" }' }),
    ]);
  });

  it('reads a path from a preceding comment', () => {
    const result = parseGeneratedFiles(
      `Here is the page.\n\n// src/app/page.tsx\n${fence('tsx', 'export default function Page() {}')}`,
    );
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.path).toBe('src/app/page.tsx');
    expect(result.files[0]!.content).toContain('export default');
  });

  it('reads a path from the fence info string', () => {
    const result = parseGeneratedFiles(
      `Setup:\n\n${fence('json package.json', '{"name":"app"}')}`,
    );
    expect(result.files[0]!.path).toBe('package.json');
  });

  it('reads a path from a markdown heading', () => {
    const result = parseGeneratedFiles(
      `### src/lib/db.ts\n${fence('ts', 'export const db = 1;')}`,
    );
    expect(result.files[0]!.path).toBe('src/lib/db.ts');
  });

  it('reads a bold path', () => {
    const result = parseGeneratedFiles(`**src/index.ts**\n${fence('ts', 'export {};')}`);
    expect(result.files[0]!.path).toBe('src/index.ts');
  });

  it('reads a "File:" prefixed path', () => {
    const result = parseGeneratedFiles(`File: src/a.ts\n${fence('ts', 'export {};')}`);
    expect(result.files[0]!.path).toBe('src/a.ts');
  });

  it('parses several files in one response', () => {
    const response = [
      '// package.json',
      fence('json', '{"name":"x"}'),
      '',
      '// src/index.ts',
      fence('ts', 'export const a = 1;'),
    ].join('\n');

    expect(parseGeneratedFiles(response).files.map((f) => f.path)).toEqual([
      'package.json',
      'src/index.ts',
    ]);
  });
});

describe('parseGeneratedFiles — what it must not do', () => {
  // An illustrative snippet is not a file to write.
  it('ignores a fence with no path', () => {
    const result = parseGeneratedFiles(`For example:\n${fence('ts', 'const x = 1;')}`);
    expect(result.files).toEqual([]);
  });

  it('ignores a fence whose preceding line is prose', () => {
    const result = parseGeneratedFiles(
      `Here is how you might approach it:\n${fence('ts', 'const x = 1;')}`,
    );
    expect(result.files).toEqual([]);
  });

  /** Generated paths are attacker-influenced input. */
  it.each([
    ['traversal', '../../../etc/passwd'],
    ['absolute', '/etc/passwd'],
    ['git config', '.git/config'],
    ['env file', '.env'],
    ['ssh key', '.ssh/id_rsa'],
  ])('rejects a %s path and records why', (_label, path) => {
    const result = parseGeneratedFiles(`// ${path}\n${fence('text', 'malicious')}`);

    expect(result.files).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.path).toBe(path);
    expect(result.rejected[0]!.reason.length).toBeGreaterThan(0);
  });

  it('keeps valid files when one path is rejected', () => {
    const response = [
      '// src/good.ts',
      fence('ts', 'export const ok = true;'),
      '',
      '// ../../evil.ts',
      fence('ts', 'export const bad = true;'),
    ].join('\n');

    const result = parseGeneratedFiles(response);
    expect(result.files.map((f) => f.path)).toEqual(['src/good.ts']);
    expect(result.rejected).toHaveLength(1);
  });
});

describe('parseGeneratedFiles — details', () => {
  it('infers language from the extension when the fence is unlabelled', () => {
    const result = parseGeneratedFiles(`// src/a.tsx\n${fence('', 'export {};')}`);
    expect(result.files[0]!.language).toBe('tsx');
  });

  it('prefers an explicit fence language', () => {
    const result = parseGeneratedFiles(`// src/a.txt\n${fence('python', 'x = 1')}`);
    expect(result.files[0]!.language).toBe('python');
  });

  // Streaming produces unterminated fences mid-flight.
  it('handles an unterminated final fence', () => {
    const result = parseGeneratedFiles('// src/a.ts\n```ts\nexport const a = 1;');
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content).toContain('export const a = 1;');
  });

  // A revised file within one response means the last version.
  it('keeps the last definition when a path repeats', () => {
    const response = [
      '// src/a.ts',
      fence('ts', 'export const version = 1;'),
      '',
      '// src/a.ts',
      fence('ts', 'export const version = 2;'),
    ].join('\n');

    const result = parseGeneratedFiles(response);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]!.content).toContain('version = 2');
  });

  it('captures prose outside file blocks as commentary', () => {
    const result = parseGeneratedFiles(
      `I created a page component.\n\n// src/a.tsx\n${fence('tsx', 'export {};')}\n\nRun npm install next.`,
    );
    expect(result.commentary).toContain('I created a page component');
    expect(result.commentary).toContain('Run npm install next');
    expect(result.commentary).not.toContain('export {}');
  });

  it('returns empty for a response with no code', () => {
    const result = parseGeneratedFiles('I need more information before I can build this.');
    expect(result.files).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.commentary).toContain('more information');
  });

  it('handles an empty response', () => {
    expect(parseGeneratedFiles('').files).toEqual([]);
  });
});
