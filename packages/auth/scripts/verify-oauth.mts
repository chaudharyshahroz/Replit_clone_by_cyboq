/**
 * Live verification of OAuth sign-in against the real database.
 *
 * The unit tests cover CSRF state. They cannot cover the rule that actually
 * decides who gets into an account, because that rule is a sequence of
 * database reads and writes. This exercises it directly:
 *
 *   - a new identity creates a user, workspace, membership and subscription
 *   - a returning identity signs into the same user
 *   - a verified address links to an existing password account
 *   - an UNVERIFIED address is refused, even when it matches exactly
 *
 * That last one is the pre-hijack takeover: anyone can type someone else's
 * address into a provider signup form. If Reklu matched on the address alone,
 * that would be enough to steal the account.
 *
 * Run: pnpm verify:oauth
 */
import { eq, inArray } from 'drizzle-orm';
import {
  accounts,
  closeDatabase,
  db,
  subscriptions,
  users,
  workspaceMembers,
  workspaces,
} from '@reklu/database';
import { newId } from '@reklu/shared';
import { signInWithOAuth } from '../src/oauth/signin';
import { registerUser } from '../src/register';

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const stamp = Date.now();
const createdUserIds: string[] = [];

const identity = (over: Partial<Parameters<typeof signInWithOAuth>[1]> = {}) => ({
  providerAccountId: `acct-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
  email: `oauth-${stamp}@verify.reklu.test`,
  emailVerified: true,
  name: 'Verify User',
  ...over,
});

try {
  console.log('\n1. A new identity creates a complete account');
  const first = identity();
  const created = await signInWithOAuth('google', first);
  createdUserIds.push(created.user.id);

  check('reported as a new user', created.isNewUser === true);
  check('has a workspace', Boolean(created.workspaceId));
  check('email marked verified', created.user.emailVerified !== null);
  // An OAuth-only account must not be reachable by password guessing.
  check('has no password hash', created.user.passwordHash === null);

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, created.user.id));
  check('owns its workspace', membership?.role === 'owner');

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, created.workspaceId));
  check('has a subscription', subscription !== undefined);

  console.log('\n2. The same identity returns to the same account');
  const returning = await signInWithOAuth('google', first);
  check('same user id', returning.user.id === created.user.id);
  check('not reported as new', returning.isNewUser === false);

  const accountRows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, created.user.id));
  check('exactly one linked account row', accountRows.length === 1, `${accountRows.length}`);

  console.log('\n3. A verified address links to an existing password account');
  const passwordEmail = `pw-${stamp}@verify.reklu.test`;
  const registered = await registerUser({
    email: passwordEmail,
    password: 'a-sufficiently-long-passphrase',
    name: 'Password User',
  });
  createdUserIds.push(registered.user.id);

  const linked = await signInWithOAuth(
    'github',
    identity({ email: passwordEmail, emailVerified: true }),
  );
  check('linked rather than duplicated', linked.user.id === registered.user.id);
  check('reported as a link', linked.linkedExisting === true);
  check('not reported as new', linked.isNewUser === false);

  const afterLink = await db.select().from(users).where(eq(users.id, registered.user.id));
  check('address now marked verified', afterLink[0]?.emailVerified !== null);

  /**
   * The gate. Everything above uses the address to decide identity, so an
   * unverified one must never get that far.
   */
  console.log('\n4. An UNVERIFIED address cannot claim an existing account');
  let refused = false;
  let message = '';
  try {
    await signInWithOAuth(
      'github',
      identity({ email: passwordEmail, emailVerified: false }),
    );
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check('refused', refused, refused ? message.slice(0, 80) : 'IT WAS ALLOWED — TAKEOVER');

  const stillOne = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, registered.user.id));
  check('no account row was created by the refused attempt', stillOne.length === 1);

  console.log('\n5. An unverified address cannot create an account either');
  let refusedNew = false;
  try {
    await signInWithOAuth(
      'google',
      identity({ email: `fresh-${stamp}@verify.reklu.test`, emailVerified: false }),
    );
  } catch {
    refusedNew = true;
  }
  check('refused', refusedNew);
} catch (error) {
  failures++;
  console.error('\nUnexpected failure:', error instanceof Error ? error.message : error);
} finally {
  console.log('\n6. Cleanup');
  if (createdUserIds.length > 0) {
    const spaces = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(inArray(workspaces.ownerId, createdUserIds));
    const spaceIds = spaces.map((row) => row.id);

    if (spaceIds.length > 0) {
      await db.delete(subscriptions).where(inArray(subscriptions.workspaceId, spaceIds));
      await db.delete(workspaceMembers).where(inArray(workspaceMembers.workspaceId, spaceIds));
    }
    await db.delete(accounts).where(inArray(accounts.userId, createdUserIds));
    if (spaceIds.length > 0) await db.delete(workspaces).where(inArray(workspaces.id, spaceIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
    check('test accounts removed', true, `${createdUserIds.length} users`);
  }
  await closeDatabase();
}

console.log(
  failures === 0
    ? '\nAll checks passed. An unverified provider address cannot claim an account.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
