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
