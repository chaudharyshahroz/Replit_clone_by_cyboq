/**
 * Live verification of the agent engine against the real database.
 *
 * The unit tests exercise the gates against in-memory objects. That is not the
 * same thing: an approval payload is written to Postgres as `jsonb`, read back,
 * and only then compared. Serialisation through the database is exactly where a
 * fingerprint mismatch would appear, and no test had ever looked.
 *
 * This runs no model calls — steps are seeded directly — so it costs nothing
 * and is safe to run repeatedly.
 *
 * Run: pnpm verify:agents
 */
import { eq, inArray } from 'drizzle-orm';
import {
  agentApprovals,
  agentRuns,
  agentSteps,
  closeDatabase,
  db,
  users,
  workspaces,
} from '@reklu/database';
import { newId } from '@reklu/shared';
import { checkApproval, fingerprint } from '../src/approvals';
import { checkBudget, parseBudget, USD } from '../src/budget';
import { advanceRun, cancelRun, decideApproval } from '../src/runner';
import { getRun, listRuns } from '../src/queries';

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
const [user] = await db.select({ id: users.id }).from(users).limit(1);
if (!ws || !user) throw new Error('Sign up first.');

const runIds: string[] = [];

/** Seed a run and its steps directly, so no model call is needed. */
async function seedRun(options: {
  maxSteps?: number;
  maxCostUsd?: string;
  steps: Array<{ title: string; kind: string; toolName?: string }>;
}): Promise<string> {
  const runId = newId('agentRun');
  runIds.push(runId);

  await db.insert(agentRuns).values({
    id: runId,
    workspaceId: ws!.id,
    userId: user!.id,
    objective: 'Verification run',
    status: 'running',
    maxSteps: options.maxSteps ?? 10,
    maxCostUsd: options.maxCostUsd ?? '5.00',
    totalSteps: options.steps.length,
    startedAt: new Date(),
  });

  for (const [index, step] of options.steps.entries()) {
    await db.insert(agentSteps).values({
      id: newId('agentStep'),
      agentRunId: runId,
      workspaceId: ws!.id,
      stepIndex: index,
      title: step.title,
      kind: step.kind,
      toolName: step.toolName ?? null,
      status: 'pending',
    });
  }

  return runId;
}

try {
  console.log('\n1. A run with no remaining steps succeeds');
  const empty = await seedRun({ steps: [] });
  const done = await advanceRun(empty, ws.id, user.id);
  check('reported succeeded', done.status === 'succeeded', done.detail);

  const reloaded = await getRun(empty, ws.id);
  check('persisted as succeeded', reloaded?.status === 'succeeded');

  console.log('\n2. Budget ceilings stop a run before a step, not after');
  const exhausted = await seedRun({
    maxSteps: 1,
    steps: [{ title: 'One', kind: 'model' }, { title: 'Two', kind: 'model' }],
  });
  await db.update(agentRuns).set({ stepsExecuted: 1 }).where(eq(agentRuns.id, exhausted));

  const stopped = await advanceRun(exhausted, ws.id, user.id);
  check('refused', stopped.status === 'failed', stopped.detail);
  check('names the step limit', /limit of 1 step/i.test(stopped.detail), stopped.detail);

  const afterLimit = await getRun(exhausted, ws.id);
  // The step must be untouched: refusing after running it would not be a limit.
  check(
    'the blocked step never ran',
    afterLimit?.steps.every((step) => step.status === 'pending') === true,
  );

  console.log('\n3. Budget arithmetic survives a round trip through the database');
  const budgeted = await seedRun({ maxCostUsd: '2.50', steps: [] });
  const [row] = await db
    .select({ maxCostUsd: agentRuns.maxCostUsd })
    .from(agentRuns)
    .where(eq(agentRuns.id, budgeted))
    .limit(1);
  check('stored budget parses back exactly', parseBudget(row?.maxCostUsd) === 2.5 * USD, row?.maxCostUsd);

  const verdict = checkBudget({
    maxSteps: 10,
    stepsExecuted: 0,
    maxCostMicroUsd: parseBudget(row?.maxCostUsd),
    spentMicroUsd: 2.5 * USD,
  });
  check('a spent budget refuses', verdict.allowed === false, verdict.reason);

  /**
   * The property the whole approvals module exists for, tested where it
   * actually has to hold: across a jsonb write and read.
   */
  console.log('\n4. Payload integrity across a real jsonb round trip');
  const approvalRun = await seedRun({ steps: [{ title: 'Send it', kind: 'model' }] });
  const approvalId = newId('agentApproval');
  const payload = {
    to: 'finance@example.com',
    subject: 'Q3 numbers',
    cc: ['a@example.com', 'b@example.com'],
    nested: { deep: { value: 42 } },
  };

  await db.insert(agentApprovals).values({
    id: approvalId,
    agentRunId: approvalRun,
    workspaceId: ws.id,
    action: 'Send an email',
    reason: 'sends email on your behalf',
    riskClass: 'update',
    payload,
    status: 'approved',
    decidedBy: user.id,
    decidedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });

  const [stored] = await db
    .select()
    .from(agentApprovals)
    .where(eq(agentApprovals.id, approvalId))
    .limit(1);

  check(
    'fingerprint survives jsonb serialisation',
    fingerprint(stored!.payload) === fingerprint(payload),
  );

  const same = checkApproval({
    record: {
      status: stored!.status,
      payload: stored!.payload,
      expiresAt: stored!.expiresAt,
      decidedAt: stored!.decidedAt,
    },
    payload,
  });
  check('the approved payload is permitted', same.mayExecute === true);

  // The bait and switch, against a stored record.
  const tampered = checkApproval({
    record: {
      status: stored!.status,
      payload: stored!.payload,
      expiresAt: stored!.expiresAt,
      decidedAt: stored!.decidedAt,
    },
    payload: { ...payload, to: 'attacker@evil.test' },
  });
  check('a changed recipient is refused', tampered.outcome === 'payload_changed');

  const added = checkApproval({
    record: {
      status: stored!.status,
      payload: stored!.payload,
      expiresAt: stored!.expiresAt,
      decidedAt: stored!.decidedAt,
    },
    payload: { ...payload, bcc: 'attacker@evil.test' },
  });
  check('an added bcc is refused', added.outcome === 'payload_changed');

  // Key order differs after a database round trip; that must not read as an attack.
  const reordered = checkApproval({
    record: {
      status: stored!.status,
      payload: stored!.payload,
      expiresAt: stored!.expiresAt,
      decidedAt: stored!.decidedAt,
    },
    payload: {
      nested: { deep: { value: 42 } },
      cc: ['a@example.com', 'b@example.com'],
      subject: 'Q3 numbers',
      to: 'finance@example.com',
    },
  });
  check('reordered keys are still permitted', reordered.mayExecute === true);

  console.log('\n5. Deciding an approval');
  const decideRun = await seedRun({ steps: [{ title: 'Act', kind: 'model' }] });
  const pendingId = newId('agentApproval');
  await db.insert(agentApprovals).values({
    id: pendingId,
    agentRunId: decideRun,
    workspaceId: ws.id,
    action: 'Do the thing',
    reason: 'changes data',
    riskClass: 'update',
    payload: { a: 1 },
    status: 'pending',
    expiresAt: new Date(Date.now() + 60_000),
  });

  await decideApproval({
    approvalId: pendingId,
    workspaceId: ws.id,
    userId: user.id,
    approve: true,
  });
  const [decided] = await db
    .select()
    .from(agentApprovals)
    .where(eq(agentApprovals.id, pendingId))
    .limit(1);
  check('recorded as approved', decided?.status === 'approved');
  check('records who decided', decided?.decidedBy === user.id);

  let doubleDecided = false;
  try {
    await decideApproval({
      approvalId: pendingId,
      workspaceId: ws.id,
      userId: user.id,
      approve: false,
    });
  } catch {
    doubleDecided = true;
  }
  check('a decided approval cannot be decided again', doubleDecided);

  console.log('\n6. Tenancy');
  const foreign = await advanceRun(empty, ws.id, user.id).catch(() => undefined);
  check('own run is reachable', foreign !== undefined);

  let blocked = false;
  try {
    await advanceRun(empty, newId('workspace'), user.id);
  } catch {
    blocked = true;
  }
  check('a run is unreachable from another workspace', blocked);

  console.log('\n7. Cancellation');
  const cancelRunId = await seedRun({ steps: [{ title: 'A', kind: 'model' }] });
  await cancelRun(cancelRunId, ws.id);
  const cancelled = await getRun(cancelRunId, ws.id);
  check('recorded as cancelled', cancelled?.status === 'cancelled');

  const afterCancel = await advanceRun(cancelRunId, ws.id, user.id);
  check('a cancelled run does not resume', afterCancel.status === 'cancelled');

  console.log('\n8. Listing');
  const listed = await listRuns(ws.id);
  check('runs are listed', listed.length >= runIds.length, `${listed.length}`);
} catch (error) {
  failures++;
  console.error('\nUnexpected failure:', error instanceof Error ? error.message : error);
} finally {
  console.log('\n9. Cleanup');
  if (runIds.length > 0) {
    await db.delete(agentApprovals).where(inArray(agentApprovals.agentRunId, runIds));
    await db.delete(agentSteps).where(inArray(agentSteps.agentRunId, runIds));
    await db.delete(agentRuns).where(inArray(agentRuns.id, runIds));
  }
  check('removed', true, `${runIds.length} runs`);
  await closeDatabase();
}

console.log(
  failures === 0
    ? '\nAll checks passed. An approved payload cannot change before it runs.\n'
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
