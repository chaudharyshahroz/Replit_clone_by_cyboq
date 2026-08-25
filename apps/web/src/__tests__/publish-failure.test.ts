/**
 * What a database failure says to the person who caused it.
 *
 * The first version printed the whole statement into the panel — four lines of
 * column names and two bound parameters, which published the schema to whoever
 * opened the tab and told them nothing. The second hid it entirely and said
 * "check the server logs", which asks someone to go and find on a machine what
 * the process already had in its hand.
 */
import { describe, expect, it } from 'vitest';

/* The extractor under test, mirrored: the action module pulls in the world. */
function databaseFault(error: unknown): { code?: string; message?: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return {
        code: candidate.code,
        message: typeof candidate.message === 'string' ? candidate.message : undefined,
      };
    }
    current = candidate.cause;
  }
  return undefined;
}

function wrapped(depth: number, code: string): Error {
  const driver = Object.assign(new Error('column "build_log" does not exist'), { code });
  let error: Error = driver;
  for (let i = 0; i < depth; i++) {
    error = Object.assign(new Error('Failed query: select ...'), { cause: error });
  }
  return error;
}

describe('finding the database fault', () => {
  it('reads a code off the error itself', () => {
    expect(databaseFault(wrapped(0, '42703'))?.code).toBe('42703');
  });

  it('walks the chain to reach a wrapped driver error', () => {
    /*
     * How deep the real error sits varies by driver and version, which is why
     * this walks rather than reaching for `.cause` a fixed number of times.
     */
    for (const depth of [1, 2, 3]) {
      expect(databaseFault(wrapped(depth, '42P01'))?.code).toBe('42P01');
    }
  });

  it('gives up rather than following a cycle for ever', () => {
    const looping: { cause?: unknown } = {};
    looping.cause = looping;
    expect(databaseFault(looping)).toBeUndefined();
  });

  it('ignores things that are not Postgres codes', () => {
    // `ECONNREFUSED` is a code, and not one that names a fault in a statement.
    expect(databaseFault(Object.assign(new Error('down'), { code: 'ECONNREFUSED' }))).toBeUndefined();
  });

  it('carries the driver sentence, which is what names the column', () => {
    expect(databaseFault(wrapped(2, '42703'))?.message).toContain('build_log');
  });
});
