/**
 * Spotting a compile failure in the dev server's output.
 *
 * The server keeps running when compilation fails — it serves an error page —
 * so nothing in Reklu's own state says anything is wrong. This is what notices.
 */
import { describe, expect, it } from 'vitest';
import { compileErrorIn } from '@/lib/compile-error';

describe('finding a failure', () => {
  it('finds a module that cannot be resolved', () => {
    const log = 'ready in 1s\n./components/Container.tsx\nModule not found: Cannot resolve "clsx"';
    expect(compileErrorIn(log)).toContain('Module not found');
  });

  it('includes the file above the message, which is where it happened', () => {
    const log = `${'x'.repeat(50)}\n./src/app/layout.tsx\nFailed to compile\nsomething`;
    expect(compileErrorIn(log)).toContain('./src/app/layout.tsx');
  });

  it('finds a font weight the loader refuses', () => {
    expect(compileErrorIn('Unknown weight `100..900` for font `Fraunces`.')).toContain(
      'Unknown weight',
    );
  });

  it('finds a PostCSS failure caused by an undefined Tailwind utility', () => {
    const log = [
      './src/app/globals.css:127:5',
      'Syntax error: The `hover:text-on-primary` class does not exist.',
    ].join('\n');

    expect(compileErrorIn(log)).toContain('hover:text-on-primary');
  });

  it('clears an old failure after hot reload compiles the repair', () => {
    const log = [
      'Syntax error: The `hover:text-on-primary` class does not exist.',
      'Compiled / in 161ms (402 modules)',
    ].join('\n');

    expect(compileErrorIn(log)).toBeNull();
  });

  it('reports a new failure that occurs after an earlier successful compile', () => {
    const log = [
      'Compiled / in 161ms (402 modules)',
      'Syntax error: The `hover:text-on-primary` class does not exist.',
    ].join('\n');

    expect(compileErrorIn(log)).toContain('hover:text-on-primary');
  });
});

describe('not crying wolf', () => {
  /* Offering to fix a warning spends a model call and a minute on nothing. */
  it('ignores ordinary output', () => {
    expect(compileErrorIn('ready in 900ms\ncompiled successfully')).toBeNull();
  });

  it('ignores a deprecation warning', () => {
    expect(compileErrorIn('warn - punycode is deprecated')).toBeNull();
  });

  it('says nothing about an empty log', () => {
    expect(compileErrorIn('')).toBeNull();
    expect(compileErrorIn('   \n  ')).toBeNull();
  });

  /* Bounded: a log can be megabytes, and a prompt cannot. */
  it('returns a bounded excerpt', () => {
    const log = `${'noise\n'.repeat(5_000)}Failed to compile\n${'detail\n'.repeat(5_000)}`;
    expect(compileErrorIn(log)!.length).toBeLessThanOrEqual(1_800);
  });
});
