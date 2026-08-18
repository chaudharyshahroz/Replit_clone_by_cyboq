/**
 * Database-backed sessions.
 *
 * The cookie carries a random opaque token; the database stores only its
 * SHA-256. A leaked database therefore yields no usable session cookies, and
 * revocation is a real delete rather than waiting for a JWT to expire — which
 * matters because Reklu holds credentials for a user's GitHub, Vercel, and MCP
 * servers.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db, sessions, users, type User } from '@reklu/database';
import { loadServerEnv } from '@reklu/shared';

export const SESSION_COOKIE = 'reklu.session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
/** Slide the expiry when a session is used, but not on every single request. */
const REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export interface SessionContext {
  readonly user: User;
  readonly sessionId: string;
  readonly expires: Date;
}

export interface CookieAttributes {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly secure: boolean;
  readonly path: '/';
  readonly expires: Date;
  /**
   * Set only when the deployment serves more than one host, so the session
   * reaches admin.reklu.app as well as reklu.app. Left undefined otherwise:
   * a broader cookie domain is a wider blast radius for no benefit.
   */
  readonly domain?: string | undefined;
}

function cookieAttributes(token: string, expires: Date): CookieAttributes {
  return {
    name: SESSION_COOKIE,
    value: token,
    // httpOnly: script cannot read it, so XSS cannot exfiltrate the session.
    httpOnly: true,
    // lax: sent on top-level navigation but not on cross-site subrequests,
    // which blocks the basic CSRF shape while keeping sign-in redirects working.
    sameSite: 'lax',
    secure: loadServerEnv().APP_URL.startsWith('https://'),
    path: '/',
    expires,
    ...(loadServerEnv().SESSION_COOKIE_DOMAIN
      ? { domain: loadServerEnv().SESSION_COOKIE_DOMAIN }
      : {}),
  };
}

/** Issue a new session. Returns the cookie to set; the raw token is never stored. */
export async function createSession(
  userId: string,
  context: { userAgent?: string | undefined; ipAddress?: string | undefined } = {},
): Promise<CookieAttributes> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({
    sessionToken: hashSessionToken(token),
    userId,
    expires,
    userAgent: context.userAgent ?? null,
    ipAddress: context.ipAddress ?? null,
    lastActiveAt: new Date(),
  });

  return cookieAttributes(token, expires);
}

/**
 * Resolve a raw cookie value to a session, or undefined.
 *
 * Returns undefined for expired sessions and for suspended users, so a
 * suspension takes effect immediately rather than at next sign-in.
 */
export async function resolveSession(token: string | undefined): Promise<SessionContext | undefined> {
  if (!token) return undefined;

  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.sessionToken, hashSessionToken(token)), gt(sessions.expires, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  if (row.user.suspendedAt) return undefined;

  // Slide the expiry, but only occasionally — a write on every request would
  // make the sessions table the hottest row in the database.
  const remaining = row.session.expires.getTime() - Date.now();
  if (remaining < SESSION_TTL_MS - REFRESH_THRESHOLD_MS) {
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    await db
      .update(sessions)
      .set({ expires, lastActiveAt: new Date() })
      .where(eq(sessions.id, row.session.id));
    return { user: row.user, sessionId: row.session.id, expires };
  }

  return { user: row.user, sessionId: row.session.id, expires: row.session.expires };
}

/** Revoke one session (sign out). */
export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.sessionToken, hashSessionToken(token)));
}

/** Revoke every session for a user — password change, or "sign out everywhere". */
export async function revokeAllSessions(userId: string): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return removed.length;
}

/** Cookie attributes that clear the session cookie. */
export function clearedSessionCookie(): CookieAttributes {
  return cookieAttributes('', new Date(0));
}

/** Housekeeping, run from the worker. */
export async function deleteExpiredSessions(): Promise<number> {
  const removed = await db
    .delete(sessions)
    .where(lt(sessions.expires, new Date()))
    .returning({ id: sessions.id });
  return removed.length;
}
