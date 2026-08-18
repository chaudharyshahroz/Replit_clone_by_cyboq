/**
 * Grant or revoke platform administrator.
 *
 * Deliberately a script and not a product feature: a UI that can grant admin
 * is a UI that can be tricked into granting it. This runs where the database
 * URL already lives, so there is no psql invocation to remember and no
 * password on a command line.
 *
 *   pnpm admin:promote you@example.com
 *   pnpm admin:promote you@example.com --revoke
 */
import { eq } from 'drizzle-orm';
import { auditLogs, closeDatabase, db, users } from '@reklu/database';
import { newId } from '@reklu/shared';

const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const email = args.find((arg) => !arg.startsWith('--'))?.trim().toLowerCase();

if (!email) {
  console.error('\nUsage: pnpm admin:promote <email> [--revoke]\n');
  process.exit(1);
}

try {
  const [user] = await db
    .select({ id: users.id, email: users.email, isSuperAdmin: users.isSuperAdmin })
    .from(users)
    .where(eq(users.emailNormalized, email))
    .limit(1);

  if (!user) {
    // Listing the addresses that DO exist turns a dead end into a next step.
    const all = await db.select({ email: users.emailNormalized }).from(users).limit(20);
    console.error(`\nNo account with the email ${email}.`);
    console.error(
      all.length > 0
        ? `Accounts on this deployment:\n${all.map((row) => `  ${row.email}`).join('\n')}\n`
        : 'This deployment has no accounts yet. Sign up first.\n',
    );
    process.exit(1);
  }

  if (user.isSuperAdmin === !revoke) {
    console.log(`\n${user.email} is already ${revoke ? 'not an' : 'an'} administrator.\n`);
    process.exit(0);
  }

  /**
   * Refuse to remove the last administrator. A platform with none cannot be
   * administered, and the fix would be this script at the worst moment.
   */
  if (revoke) {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.isSuperAdmin, true));

    if (admins.length <= 1) {
      console.error('\nThis is the only administrator. Promote someone else first.\n');
      process.exit(1);
    }
  }

  await db.update(users).set({ isSuperAdmin: !revoke }).where(eq(users.id, user.id));

  // The same trail the panel writes, so a change made here is not invisible.
  await db.insert(auditLogs).values({
    id: newId('auditLog'),
    actorId: user.id,
    actorEmail: user.email,
    isAdminAction: true,
    action: revoke ? 'user.revoke_admin' : 'user.grant_admin',
    resourceType: 'user',
    resourceId: user.id,
    changes: { via: 'promote-admin script' },
  });

  console.log(
    `\n${user.email} is ${revoke ? 'no longer' : 'now'} a platform administrator.\n` +
      (revoke ? '' : 'Sign in at your admin host to use the panel.\n'),
  );
} finally {
  await closeDatabase();
}
