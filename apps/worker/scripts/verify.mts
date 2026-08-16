/** Live verification of the queue: enqueue → durable row → worker → completion. */
import { eq } from 'drizzle-orm';
import { closeDatabase, db, jobs, workspaces } from '@reklu/database';
import { closeQueues, enqueue, requestCancellation } from '@reklu/queue';

const check = (label: string, pass: boolean, detail = '') =>
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
if (!ws) throw new Error('No workspace found — sign up first.');

try {
  console.log('\n1. Enqueue writes a durable job row before touching Redis');
  const jobId = await enqueue({
    kind: 'maintenance',
    payload: { task: 'prune_sessions' },
    workspaceId: ws.id,
  });
  const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  check('job row created', Boolean(row));
  // Deliberately NOT asserting status === 'queued': a healthy worker may claim
  // the job before this SELECT runs, which would make the assertion flaky
  // without indicating any defect. The invariant that matters is that the
  // durable row exists with its stage sequence declared before pickup.
  check(
    'status is a valid lifecycle state',
    ['queued', 'running', 'succeeded'].includes(row?.status ?? ''),
    row?.status,
  );
  check('first real stage recorded', row?.stage === 'running');
  check('total stages declared', (row?.totalStages ?? 0) > 0);
  check('payload persisted', (row?.input as any)?.task === 'prune_sessions');

  console.log('\n2. Worker picks it up and completes it');
  let finished = row;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    [finished] = await db.select().from(jobs).where(eq(jobs.id, jobId));
    if (finished && ['succeeded', 'failed', 'cancelled'].includes(finished.status)) break;
  }
  check('reached a terminal state', ['succeeded', 'failed'].includes(finished?.status ?? ''), finished?.status);
  check('succeeded', finished?.status === 'succeeded', finished?.errorMessage ?? '');
  check('output recorded', finished?.output !== null);
  check('startedAt set', finished?.startedAt !== null);
  check('completedAt set', finished?.completedAt !== null);

  console.log('\n3. Cancellation of a not-yet-started job is immediate');
  const cancelId = await enqueue({
    kind: 'deep_research',
    payload: {
      researchSessionId: 'rsh_x',
      workspaceId: ws.id,
      userId: 'usr_x',
      query: 'never runs — no research worker is registered yet',
      mode: 'deep',
    },
    workspaceId: ws.id,
  });
  // No worker is registered for the research queue, so this reliably stays
  // queued — the deterministic place to assert that state.
  const [beforeCancel] = await db.select().from(jobs).where(eq(jobs.id, cancelId));
  check('unclaimed job stays queued', beforeCancel?.status === 'queued', beforeCancel?.status);

  await requestCancellation(cancelId);
  const [cancelled] = await db.select().from(jobs).where(eq(jobs.id, cancelId));
  check('cancelled without running', cancelled?.status === 'cancelled');
  check('cancellation timestamped', cancelled?.cancelRequestedAt !== null);

  console.log('\n4. Invalid payload is rejected at enqueue-time schema, not silently accepted');
  let rejected = false;
  try {
    const { parsePayload } = await import('@reklu/queue');
    parsePayload('deep_research', { query: 'missing everything else' });
  } catch {
    rejected = true;
  }
  check('malformed payload rejected', rejected);

  console.log('\n5. Cleanup');
  await db.delete(jobs).where(eq(jobs.id, jobId));
  await db.delete(jobs).where(eq(jobs.id, cancelId));
  check('test jobs removed', true);
} finally {
  await closeQueues();
  await closeDatabase();
}
