/**
 * The waitlist.
 *
 * This is the one place in Reklu that anybody on the internet can write to
 * without an account, which changes what the code has to worry about. Not
 * correctness — an email address in a text column is not hard — but the fact
 * that every protection here is the only protection.
 */
import { desc, sql } from 'drizzle-orm';
import { db, waitlistSignups, type WaitlistSignup } from '@reklu/database';
import { logger, newId } from '@reklu/shared';

/**
 * How many addresses one caller may add before being asked to wait.
 *
 * In memory, which means per process: a second instance has its own count, and
 * a restart forgets. Said plainly rather than dressed up, because the honest
 * description of this is "a speed bump". It stops a script adding ten thousand
 * rows from one laptop; it is not a defence against anyone who has read this
 * comment and owns more than one machine. The unique index is what actually
 * bounds the damage — a flood of the same address is one row.
 */
const PER_WINDOW = 5;
const WINDOW_MS = 60 * 60 * 1_000;

const recent = new Map<string, number[]>();

function withinRate(caller: string): boolean {
  const now = Date.now();
  const seen = (recent.get(caller) ?? []).filter((at) => now - at < WINDOW_MS);

  if (seen.length >= PER_WINDOW) {
    recent.set(caller, seen);
    return false;
  }

  seen.push(now);
  recent.set(caller, seen);

  /* Bounded, so a long-running process does not accumulate callers for ever. */
  if (recent.size > 10_000) {
    for (const [key, times] of recent) {
      if (times.every((at) => now - at >= WINDOW_MS)) recent.delete(key);
    }
  }

  return true;
}

/**
 * Is this an email address?
 *
 * Deliberately loose. The real check is whether the invitation arrives, and a
 * strict pattern is how a valid address gets turned away — the grammar allows
 * far more than most patterns admit. What is worth refusing is the input that
 * is plainly not an address at all.
 */
export function readEmail(input: string): { email: string } | { error: string } {
  const email = input.trim().toLowerCase();

  if (!email) return { error: 'Enter your email address.' };
  if (email.length > 254) return { error: 'That address is too long.' };
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) {
    return { error: 'That does not look like an email address.' };
  }

  return { email };
}

export interface JoinResult {
  readonly ok: boolean;
  readonly message: string;
}

/**
 * Add somebody to the list.
 *
 * An address that is already on it gets the same answer as one that is not.
 * The alternative turns the form into a way to ask "is this person waiting for
 * Reklu?" about any address somebody cares to type, which is a question about
 * another person that this form has no business answering.
 */
export async function joinWaitlist(input: {
  readonly email: string;
  readonly source?: string | undefined;
  /** A field no person can see. Anything filling it in is not a person. */
  readonly trap?: string | undefined;
  /** Identifies the caller for rate limiting. Never stored. */
  readonly caller: string;
}): Promise<JoinResult> {
  const confirmation = "You're on the list. We'll email you when Reklu opens.";

  /*
   * Answered as though it worked. A bot told that it was detected learns to
   * stop filling the field in; one told it succeeded goes away satisfied.
   */
  if (input.trap) return { ok: true, message: confirmation };

  const parsed = readEmail(input.email);
  if ('error' in parsed) return { ok: false, message: parsed.error };

  if (!withinRate(input.caller)) {
    return { ok: false, message: 'That is a lot of signups. Try again in a little while.' };
  }

  try {
    await db
      .insert(waitlistSignups)
      .values({
        id: newId('waitlistSignup'),
        email: parsed.email,
        source: input.source?.slice(0, 100) ?? null,
      })
      /* Already waiting. Their place is where they first joined, not now. */
      .onConflictDoNothing({ target: waitlistSignups.email });
  } catch (error) {
    logger.error('A waitlist signup could not be saved', { error });
    return { ok: false, message: 'That could not be saved. Try again in a moment.' };
  }

  return { ok: true, message: confirmation };
}

export interface WaitlistPage {
  readonly entries: readonly WaitlistSignup[];
  readonly total: number;
  readonly invited: number;
  /** How many joined in the last seven days, which is the only trend worth a line. */
  readonly thisWeek: number;
}

/** The list, newest first, for the admin panel. */
export async function listWaitlist(limit = 500): Promise<WaitlistPage> {
  const [entries, counts] = await Promise.all([
    db.select().from(waitlistSignups).orderBy(desc(waitlistSignups.createdAt)).limit(limit),
    db
      .select({
        total: sql<number>`count(*)::int`,
        invited: sql<number>`count(${waitlistSignups.invitedAt})::int`,
        thisWeek: sql<number>`count(*) filter (where ${waitlistSignups.createdAt} > now() - interval '7 days')::int`,
      })
      .from(waitlistSignups),
  ]);

  const row = counts[0];
  return {
    entries,
    total: row?.total ?? 0,
    invited: row?.invited ?? 0,
    thisWeek: row?.thisWeek ?? 0,
  };
}

/**
 * The list as a file, for sending the invitations somewhere else.
 *
 * Reklu has no mail provider configured, so it cannot send them itself. Rather
 * than a Send button that does nothing, the addresses come out in the format
 * every mailing tool imports.
 */
export function waitlistCsv(entries: readonly WaitlistSignup[]): string {
  const rows = entries.map((entry) =>
    [
      /*
       * Quoted, and inner quotes doubled. An address is unlikely to contain a
       * comma, and "unlikely" is not a reason to emit a file that breaks when
       * one does.
       */
      `"${entry.email.replace(/"/g, '""')}"`,
      `"${(entry.source ?? '').replace(/"/g, '""')}"`,
      entry.createdAt.toISOString(),
      entry.invitedAt ? entry.invitedAt.toISOString() : '',
    ].join(','),
  );

  return ['email,source,joined_at,invited_at', ...rows].join('\n');
}
