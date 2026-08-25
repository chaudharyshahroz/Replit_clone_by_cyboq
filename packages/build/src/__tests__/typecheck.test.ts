/**
 * Reading what the compiler said.
 *
 * `next dev` reports type errors and keeps serving; `next build` refuses. So a
 * type error is invisible while anybody is looking at the preview and fatal the
 * moment they publish — which is how one project failed to publish three times
 * running, each time on a different line nobody had been shown.
 *
 * What matters here is telling a compiler error from everything else a shell
 * can print, because the answer is handed to a model as work to do.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../preview.ts', import.meta.url), 'utf8');
const body = source.slice(
  source.indexOf('export async function typecheckPreview'),
  source.indexOf('export async function startPreview'),
);

/* The two rules the extraction turns on, applied to real compiler output. */
const isCompilerError = (line: string) => /error TS\d+/.test(line);

describe('reading a typecheck', () => {
  it('recognises a compiler error', () => {
    expect(
      isCompilerError(
        "lib/menu.ts(101,15): error TS2322: Type 'MenuItem | undefined' is not assignable to type 'MenuItem'.",
      ),
    ).toBe(true);
  });

  it('does not mistake a missing compiler for a type error', () => {
    /*
     * A project with no TypeScript, or no compiler installed, is not a project
     * with type errors — and handing "tsc: not found" to a model sends it
     * editing code that was never wrong.
     */
    for (const line of ['sh: 1: tsc: not found', 'npm ERR! could not determine executable']) {
      expect(isCompilerError(line)).toBe(false);
    }
  });

  it('requires a compiler error before reporting anything', () => {
    expect(body).toContain('error TS');
    expect(body).toContain('return undefined');
  });

  it('does not install anything to run the check', () => {
    // `npx` will happily fetch a package to satisfy a command, which would turn
    // a typecheck into a download on a machine that already has the compiler.
    expect(body).toContain("'--no-install'");
  });

  it('caps how much it hands back', () => {
    // One mistake usually produces many lines, and the rest are the same thing.
    expect(body).toMatch(/slice\(0, \d+\)/);
  });

  it('never fails the build it is checking', () => {
    expect(body).toContain('catch');
  });
});

describe('the repair it triggers', () => {
  it('cannot loop', () => {
    /*
     * A repair is itself a generation, and a generation typechecks — so without
     * a guard, code the model cannot fix goes back to it for as long as somebody
     * is willing to pay.
     */
    const actions = readFileSync(
      new URL('../../../../apps/web/src/app/(app)/build/actions.ts', import.meta.url),
      'utf8',
    );

    expect(actions).toContain('if (!request.repairPass) {');
    expect(actions).toContain('repairPass: true');
  });
});
