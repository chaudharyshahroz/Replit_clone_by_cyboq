/**
 * Live verification of the auth invariants against the real database.
 * Not a unit test — this exercises the actual transactional paths.
 */
import { authenticate, registerUser } from '@reklu/auth';
import { closeDatabase, db, users, workspaces, workspaceMembers, subscriptions } from '@reklu/database';
import { eq } from 'drizzle-orm';
import { isRekluError } from '@reklu/shared';

const check = (label: string, pass: boolean, detail = '') =>
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

const email = `verify-${Date.now()}@example.com`;
const password = 'a sufficiently long passphrase';

try {
  console.log('\n1. Registration creates user + workspace + membership + subscription');
  const { user, workspaceId } = await registerUser({ email, password, name: 'Verify User' });

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  const members = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
  const subs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId));

  check('user created', Boolean(user.id));
  check('personal workspace created', ws?.isPersonal === true);
  check('owner membership created', members[0]?.role === 'owner');
  check('free subscription created', subs[0]?.status === 'active');
  check('password not stored in plaintext', !user.passwordHash?.includes(password));

  console.log('\n2. Duplicate registration is rejected');
  try {
    await registerUser({ email, password, name: 'Impostor' });
    check('duplicate rejected', false, 'second registration succeeded');
  } catch (e) {
    check('duplicate rejected', isRekluError(e) && e.code === 'VALIDATION_FAILED');
  }

  console.log('\n3. Authentication');
  check('correct password accepted', Boolean(await authenticate(email, password)));
  check('wrong password rejected', (await authenticate(email, 'wrong password entirely')) === undefined);
  check('unknown account rejected', (await authenticate('nobody@example.com', password)) === undefined);
  check('email is case-insensitive', Boolean(await authenticate(email.toUpperCase(), password)));

  console.log('\n4. Timing: unknown account should not be measurably faster');
  const time = async (fn: () => Promise<unknown>) => {
    const t = process.hrtime.bigint();
    await fn();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  const known = await time(() => authenticate(email, 'wrong password entirely'));
  const unknown = await time(() => authenticate('nobody@example.com', 'wrong password entirely'));
  const ratio = unknown / known;
  check(
    'timing comparable (0.4x–2.5x)',
    ratio > 0.4 && ratio < 2.5,
    `known=${known.toFixed(0)}ms unknown=${unknown.toFixed(0)}ms ratio=${ratio.toFixed(2)}`,
  );

  console.log('\n5. Owner FK is RESTRICT: a user owning a workspace cannot be deleted');
  let restricted = false;
  try {
    await db.delete(users).where(eq(users.id, user.id));
  } catch {
    restricted = true;
  }
  check('deleting an owning user is refused', restricted);

  console.log('\n6. Cleanup');
  // Workspace first — it holds the FK to the owner.
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await db.delete(users).where(eq(users.id, user.id));
  const gone = await db.select().from(users).where(eq(users.id, user.id));
  check('test rows removed', gone.length === 0);
} finally {
  await closeDatabase();
}
