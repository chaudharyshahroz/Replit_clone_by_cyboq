import { describe, expect, it } from 'vitest';
import { compileErrorIn } from '../compile-log';

describe('server-side compiler log detection', () => {
  it('detects a Next.js SWC syntax failure after the server is ready', () => {
    const log = [
      '✓ Ready in 2.1s',
      '○ Compiling / ...',
      '⨯ ./src/components/features/Hero.tsx',
      'Error:',
      '  x Unexpected token `section`. Expected jsx identifier',
      '    /home/node/app/src/components/features/Hero.tsx:13:1',
      'Caused by:',
      '    Syntax Error',
      'GET / 500 in 933ms',
    ].join('\n');

    const failure = compileErrorIn(log);
    expect(failure).toContain('Hero.tsx');
    expect(failure).toContain('Unexpected token `section`');
  });

  it('does not mistake missing optional SWC platform packages for a failure', () => {
    const log = [
      "<w> Managed item /node_modules/@next/swc-linux-arm64-musl isn't a directory",
      "<w> Managed item /node_modules/@next/swc-darwin-x64 isn't a directory",
      '✓ Ready in 1477ms',
    ].join('\n');

    expect(compileErrorIn(log)).toBeNull();
  });

  it('clears the SWC failure after a successful rebuild', () => {
    const log = [
      'Unexpected token `section`. Expected jsx identifier',
      'Caused by: Syntax Error',
      'Compiled / in 161ms (402 modules)',
    ].join('\n');

    expect(compileErrorIn(log)).toBeNull();
  });
});
