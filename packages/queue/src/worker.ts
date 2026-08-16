/**
 * Worker runtime: the bridge between BullMQ and the durable `jobs` row.
 *
 * Handlers receive a `JobContext` rather than a raw BullMQ job. That context is
 * what enforces the product's honesty rules — `reportStage` writes a stage the
 * code is *actually* entering, and `throwIfCancelled` is what makes a cancelled
 * job stop spending on provider calls instead of running to completion.
 */
import { Worker, type Job as BullJob } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, jobs } from '@reklu/database';
import { loadServerEnv, logger, toRekluError } from '@reklu/shared';
import { parsePayload, stagesFor, type JobKind, type PayloadFor } from './contracts';
import { redis } from './queue';

export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was cancelled`);
    this.name = 'JobCancelledError';
  }
}

export interface JobContext<K extends JobKind> {
  readonly jobId: string;
  readonly kind: K;
  readonly payload: PayloadFor<K>;
  readonly log: ReturnType<typeof logger.child>;

  /**
   * Announce the stage now beginning. Must be a stage declared for this job
   * kind — a typo would otherwise surface as a meaningless label in the UI.
   */
  reportStage(stage: string, detail?: string): Promise<void>;

  /** Throws {@link JobCancelledError} if the user asked to stop. */
  throwIfCancelled(): Promise<void>;
}

export type JobHandler<K extends JobKind> = (context: JobContext<K>) => Promise<unknown>;

async function isCancelled(jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ cancelRequestedAt: jobs.cancelRequestedAt })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  return Boolean(row?.cancelRequestedAt);
}

function buildContext<K extends JobKind>(
  jobId: string,
  kind: K,
  payload: PayloadFor<K>,
): JobContext<K> {
  const validStages = stagesFor(kind);
  const log = logger.child({ jobId, kind });

  return {
    jobId,
    kind,
    payload,
    log,

    async reportStage(stage, detail) {
      const index = validStages.indexOf(stage);
      if (index === -1) {
        // Fail loudly: an undeclared stage means the UI would show a label the
        // progress list does not know about.
        throw new Error(
          `Stage "${stage}" is not declared for job kind "${kind}". ` +
            `Declared stages: ${validStages.join(', ')}`,
        );
      }
      log.info('Job stage', { stage, detail });
      await db
        .update(jobs)
        .set({ stage, stageIndex: index, stageDetail: detail ?? null })
        .where(eq(jobs.id, jobId));
    },

    async throwIfCancelled() {
      if (await isCancelled(jobId)) throw new JobCancelledError(jobId);
    },
  };
}

export interface WorkerRegistration<K extends JobKind> {
  readonly kind: K;
  readonly handler: JobHandler<K>;
  readonly concurrency?: number;
}

/**
 * Start a worker for one queue, dispatching by job kind.
 *
 * Concurrency is bounded per queue: spec §109 requires that a burst of work
 * cannot spawn unbounded parallel provider calls.
 */
export function startWorker(params: {
  readonly queueName: string;
  readonly registrations: readonly WorkerRegistration<JobKind>[];
  readonly concurrency?: number;
}): Worker {
  // Namespacing goes through BullMQ's `prefix`, not the queue name — see
  // queue.ts. Producer and consumer must agree on both.
  const prefix = loadServerEnv().QUEUE_PREFIX;
  const byKind = new Map(params.registrations.map((r) => [r.kind, r]));

  const worker = new Worker(
    params.queueName,
    async (bullJob: BullJob) => {
      const jobId = (bullJob.data as { jobId?: string }).jobId ?? bullJob.id!;
      const kind = bullJob.name as JobKind;
      const registration = byKind.get(kind);

      if (!registration) {
        throw new Error(`No handler registered for job kind "${kind}"`);
      }

      // Validate at the boundary rather than trusting the producer.
      const payload = parsePayload(kind, bullJob.data);
      const context = buildContext(jobId, kind, payload);

      await db
        .update(jobs)
        .set({
          status: 'running',
          startedAt: new Date(),
          attempts: bullJob.attemptsMade + 1,
        })
        .where(eq(jobs.id, jobId));

      try {
        await context.throwIfCancelled();
        const output = await registration.handler(context);

        await db
          .update(jobs)
          .set({
            status: 'succeeded',
            output: (output ?? null) as never,
            completedAt: new Date(),
            stageIndex: stagesFor(kind).length,
          })
          .where(eq(jobs.id, jobId));

        return output;
      } catch (error) {
        const cancelled = error instanceof JobCancelledError;
        const rekluError = cancelled ? undefined : toRekluError(error);

        await db
          .update(jobs)
          .set({
            status: cancelled ? 'cancelled' : 'failed',
            errorCode: rekluError?.code ?? (cancelled ? 'JOB_CANCELLED' : 'INTERNAL'),
            // The user-facing message, not the stack trace.
            errorMessage: cancelled
              ? 'Cancelled.'
              : (rekluError?.userMessage ?? 'This job failed.'),
            completedAt: new Date(),
          })
          .where(eq(jobs.id, jobId));

        context.log.error('Job failed', { error, cancelled });
        // Cancellation is a terminal outcome, not a retryable failure.
        if (cancelled) return undefined;
        throw error;
      }
    },
    {
      prefix,
      connection: redis(),
      concurrency: params.concurrency ?? 3,
    },
  );

  worker.on('failed', (job, error) => {
    logger.error('BullMQ job failed', { jobId: job?.id, error });
  });

  return worker;
}
