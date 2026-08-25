/**
 * The waitlist, which is the one thing in Reklu that anybody on the internet
 * can write to without an account. Every protection here is the only
 * protection, so each one is worth a test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const insert = vi.fn();

vi.mock('@reklu/database', () => ({
  db: { insert: () => ({ values: () => ({ onConflictDoNothing: insert }) }) },
  waitlistSignups: { email: 'email' },
}));

const { joinWaitlist, readEmail, waitlistCsv } = await import('../lib/waitlist');

beforeEach(() => {
  insert.mockReset().mockResolvedValue(undefined);
});

/** A fresh caller each time, so one test's rate limit is not another's. */
let callerCount = 0;
const caller = () => `caller-${callerCount++}`;

describe('reading an email address', () => {
  it('lowercases and trims it', () => {
    expect(readEmail('  Someone@Example.COM ')).toEqual({ email: 'someone@example.com' });
  });

  it('refuses what is plainly not an address', () => {
    for (const input of ['', 'someone', 'someone@', '@example.com', 'someone@example', 'a b@c.com']) {
      expect(readEmail(input)).toHaveProperty('error');
    }
  });

  it('accepts the unusual but legal', () => {
    /*
     * A strict pattern is how a valid address gets turned away — the grammar
     * allows far more than most patterns admit, and the real check is whether
     * the invitation arrives.
     */
    for (const input of ["o'brien+tag@sub.example.co.uk", 'a@b.io', 'first.last@example.museum']) {
      expect(readEmail(input)).toHaveProperty('email');
    }
  });
});

describe('joining', () => {
  it('stores the address', async () => {
    const result = await joinWaitlist({ email: 'Someone@Example.com', caller: caller() });

    expect(result.ok).toBe(true);
    expect(insert).toHaveBeenCalled();
  });

  it('answers an address already on the list exactly as it answers a new one', async () => {
    /*
     * The alternative turns the form into a way to ask "is this person waiting
     * for Reklu?" about any address somebody cares to type — a question about
     * another person that this form has no business answering.
     */
    const first = await joinWaitlist({ email: 'a@example.com', caller: caller() });
    const again = await joinWaitlist({ email: 'a@example.com', caller: caller() });

    expect(again).toEqual(first);
  });

  it('tells a bot it succeeded', async () => {
    // One told it was detected learns to stop filling the field in.
    const result = await joinWaitlist({ email: 'a@example.com', trap: 'Acme', caller: caller() });

    expect(result.ok).toBe(true);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses a bad address without touching the database', async () => {
    const result = await joinWaitlist({ email: 'nonsense', caller: caller() });

    expect(result.ok).toBe(false);
    expect(insert).not.toHaveBeenCalled();
  });

  it('slows a caller down after several signups', async () => {
    const one = caller();
    const results = [];
    for (let i = 0; i < 7; i++) {
      results.push(await joinWaitlist({ email: `person${i}@example.com`, caller: one }));
    }

    expect(results.slice(0, 5).every((result) => result.ok)).toBe(true);
    expect(results[5]?.ok).toBe(false);
    expect(results[6]?.ok).toBe(false);
  });

  it('counts callers separately', async () => {
    const busy = caller();
    for (let i = 0; i < 6; i++) {
      await joinWaitlist({ email: `x${i}@example.com`, caller: busy });
    }

    const other = await joinWaitlist({ email: 'new@example.com', caller: caller() });
    expect(other.ok).toBe(true);
  });

  it('reports a database failure rather than claiming success', async () => {
    insert.mockRejectedValueOnce(new Error('down'));
    const result = await joinWaitlist({ email: 'a@example.com', caller: caller() });

    expect(result.ok).toBe(false);
  });
});

describe('the export', () => {
  const entry = (email: string, source: string | null = null) => ({
    id: 'wls_1',
    email,
    source,
    invitedAt: null,
    createdAt: new Date('2026-08-25T10:00:00Z'),
    updatedAt: new Date('2026-08-25T10:00:00Z'),
  });

  it('writes a header and a row per address', () => {
    const csv = waitlistCsv([entry('a@example.com', 'hero')]);

    expect(csv.split('\n')[0]).toBe('email,source,joined_at,invited_at');
    expect(csv).toContain('"a@example.com"');
    expect(csv).toContain('"hero"');
  });

  it('survives a value containing a quote', () => {
    // Unlikely is not a reason to emit a file that breaks when it happens.
    const csv = waitlistCsv([entry('a@example.com', 'the "big" launch')]);
    expect(csv).toContain('"the ""big"" launch"');
  });
});
