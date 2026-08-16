/**
 * Queue producer and the durable job record.
 *
 * Redis carries the work; Postgres holds the truth (DECISIONS.md D9). Enqueuing
 * writes a `jobs` row **first**, so a Redis restart costs throughput rather than
 * a user's in-flight deep research run, and the Activity panel has one
 * queryable source.
 */
import { Queue, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { db, jobs } from '@reklu/database';
import { loadServerEnv, logger, newId } from '@reklu/shared';
import { queueFor, stagesFor, type JobKind, type PayloadFor } from './contracts';

let connection: Redis | undefined;

/** Shared Redis connection. BullMQ requires `maxRetriesPerRequest: null`. */
export function redis(): Redis {
  if (!connection) {
    connection = new IORedis(loadServerEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    connection.on('error', (error) => logger.error('Redis connection error', { error }));
  }
  return connection;
}

const queues = new Map<string, Queue>();

export function queue(name: string): Queue {
  // BullMQ rejects ':' inside a queue name — namespacing is its `prefix`
  // option, which it composes into the Redis keyspace itself.
  const prefix = loadServerEnv().QUEUE_PREFIX;
  const key = `${prefix}/${name}`;
  let existing = queues.get(key);
  if (!existing) {
    existing = new Queue(name, {
      prefix,
      connection: redis(),
      defaultJobOptions: {
        attempts: 3,
        // Exponential backoff so a struggling provider is not hammered.
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      },
    });
    queues.set(key, existing);
  }
  return existing;
}

export interface EnqueueOptions<K extends JobKind> {
  readonly kind: K;
  readonly payload: PayloadFor<K>;
  readonly workspaceId: string;
  readonly userId?: string | null;
  readonly projectId?: string | null;
  /** Links the job to the domain row it produces, for the Activity panel. */
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly jobOptions?: JobsOptions;
}

/**
 * Create the durable record and enqueue it.
 *
 * The Postgres id is reused as the BullMQ job id, which makes enqueuing
 * idempotent: a retried request cannot produce two runs of the same work.
 */
export async function enqueue<K extends JobKind>(options: EnqueueOptions<K>): Promise<string> {
  const jobId = newId('job');
  const stages = stagesFor(options.kind);

  await db.insert(jobs).values({
    id: jobId,
    workspaceId: options.workspaceId,
    userId: options.userId ?? null,
    projectId: options.projectId ?? null,
    queue: queueFor(options.kind),
    kind: options.kind,
    status: 'queued',
    stage: stages[0] ?? null,
    stageIndex: 0,
    totalStages: stages.length,
    input: options.payload as Record<string, unknown>,
    resourceType: options.resourceType ?? null,
    resourceId: options.resourceId ?? null,
  });

  try {
    await queue(queueFor(options.kind)).add(
      options.kind,
      { jobId, ...options.payload },
      { jobId, ...options.jobOptions },
    );
  } catch (error) {
    // Redis unavailable: mark the row failed rather than leaving it queued
    // forever with no worker that will ever pick it up.
    await db
      .update(jobs)
      .set({
        status: 'failed',
        errorCode: 'QUEUE_UNAVAILABLE',
        errorMessage: 'Could not reach the job queue.',
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
    throw error;
  }

  logger.info('Job enqueued', { jobId, kind: options.kind, workspaceId: options.workspaceId });
  return jobId;
}

/**
 * Request cancellation (spec §106).
 *
 * Cooperative: the worker checks between stages. Setting the flag also removes
 * a job that has not started yet, so cancelling before pickup is immediate.
 */
export async function requestCancellation(jobId: string): Promise<void> {
  const [row] = await db
    .update(jobs)
    .set({ cancelRequestedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning({ queue: jobs.queue, status: jobs.status });

  if (!row) return;

  if (row.status === 'queued') {
    const bullJob = await queue(row.queue).getJob(jobId);
    await bullJob?.remove().catch(() => undefined);
    await db
      .update(jobs)
      .set({ status: 'cancelled', completedAt: new Date() })
      .where(eq(jobs.id, jobId));
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    connection.disconnect();
    connection = undefined;
  }
}

/** Liveness probe for /api/health and the worker's readiness gate. */
export async function checkQueueHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await redis().ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
