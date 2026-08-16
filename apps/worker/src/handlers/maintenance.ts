/**
 * Housekeeping tasks.
 *
 * Real work, running today: expired sessions and stale approvals accumulate
 * without this, and an unreaped sandbox keeps costing money.
 */
import { and, eq, lt } from 'drizzle-orm';
import { agentApprovals, db, sandboxes, sessions } from '@reklu/database';
import type { JobContext } from '@reklu/queue';

export async function maintenanceHandler(
  context: JobContext<'maintenance'>,
): Promise<{ task: string; affected: number }> {
  await context.reportStage('running', context.payload.task);
  const now = new Date();

  switch (context.payload.task) {
    case 'prune_sessions': {
      const removed = await db
        .delete(sessions)
        .where(lt(sessions.expires, now))
        .returning({ id: sessions.id });
      context.log.info('Pruned expired sessions', { count: removed.length });
      return { task: 'prune_sessions', affected: removed.length };
    }

    case 'reap_sandboxes': {
      // An idle sandbox past its expiry is billable compute doing nothing.
      const reaped = await db
        .update(sandboxes)
        .set({ status: 'stopped', stoppedAt: now })
        .where(and(lt(sandboxes.expiresAt, now), eq(sandboxes.status, 'idle')))
        .returning({ id: sandboxes.id });
      context.log.info('Reaped idle sandboxes', { count: reaped.length });
      return { task: 'reap_sandboxes', affected: reaped.length };
    }

    case 'expire_approvals': {
      // An unanswered approval must not block an agent run forever.
      const expired = await db
        .update(agentApprovals)
        .set({ status: 'expired' })
        .where(and(lt(agentApprovals.expiresAt, now), eq(agentApprovals.status, 'pending')))
        .returning({ id: agentApprovals.id });
      context.log.info('Expired stale approvals', { count: expired.length });
      return { task: 'expire_approvals', affected: expired.length };
    }
  }
}
