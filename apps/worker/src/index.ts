/**
 * Reklu worker process.
 *
 * Runs the queues that back long operations. Deployed as a separate service
 * from the web app (docs/DEPLOYMENT.md) so a burst of research or builds cannot
 * starve request handling.
 *
 * Handlers for research, build, deploy, media and agents arrive with their
 * milestones. What exists today is the runtime itself — registration,
 * validation, real stage reporting, cancellation, graceful shutdown — plus the
 * maintenance queue, which is genuinely live.
 */
import { closeDatabase, checkDatabaseHealth } from '@reklu/database';
import {
  checkQueueHealth,
  closeQueues,
  startWorker,
  type JobKind,
  type WorkerRegistration,
} from '@reklu/queue';
import { loadServerEnv, logger } from '@reklu/shared';
import { agentRunHandler } from './handlers/agent';
import { maintenanceHandler } from './handlers/maintenance';
import { deepResearchHandler } from './handlers/research';
import { buildDesignHandler } from './handlers/build-design';

const log = logger.child({ service: 'worker' });

async function main(): Promise<void> {
  // Fails loudly and immediately on bad configuration, rather than after the
  // first job is picked up.
  const env = loadServerEnv();

  const database = await checkDatabaseHealth();
  if (!database.ok) {
    throw new Error(`Database unreachable: ${database.error ?? 'unknown error'}`);
  }
  const queueHealth = await checkQueueHealth();
  if (!queueHealth.ok) {
    throw new Error(
      `Redis unreachable at ${env.REDIS_URL.replace(/\/\/.*@/, '//')}: ${queueHealth.error ?? 'unknown error'}`,
    );
  }

  log.info('Worker starting', {
    databaseLatencyMs: database.latencyMs,
    redisLatencyMs: queueHealth.latencyMs,
    vectorEnabled: database.vectorEnabled,
  });

  const workers = [
    startWorker({
      queueName: 'build',
      registrations: [
        {
          kind: 'build_design',
          handler: buildDesignHandler as WorkerRegistration<JobKind>['handler'],
        },
      ],
      concurrency: 1,
    }),
    startWorker({
      queueName: 'maintenance',
      registrations: [
        {
          kind: 'maintenance',
          handler: maintenanceHandler as WorkerRegistration<JobKind>['handler'],
        },
      ],
      concurrency: 1,
    }),
    startWorker({
      queueName: 'research',
      registrations: [
        {
          kind: 'deep_research',
          handler: deepResearchHandler as WorkerRegistration<JobKind>['handler'],
        },
      ],
      // Deep research is the most expensive operation in the product; bounding
      // concurrency is a cost control, not just a throughput knob (spec §109).
      concurrency: 2,
    }),
    startWorker({
      queueName: 'agent',
      registrations: [
        {
          kind: 'agent_run',
          handler: agentRunHandler as WorkerRegistration<JobKind>['handler'],
        },
      ],
      // An agent run is a loop of model calls, so the same cost reasoning
      // applies as for research — more so, since one run makes many calls.
      concurrency: 2,
    }),
  ];

  log.info('Worker ready', { queues: workers.length });

  // ---- Graceful shutdown (spec §152) -------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down', { signal });

    // close() waits for in-flight jobs so a deploy does not abandon work
    // mid-stage, leaving a `running` row nothing will ever finish.
    const timeout = setTimeout(() => {
      log.error('Shutdown timed out; exiting forcefully');
      process.exit(1);
    }, 30_000);

    try {
      await Promise.all(workers.map((worker) => worker.close()));
      await closeQueues();
      await closeDatabase();
      clearTimeout(timeout);
      log.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      log.error('Shutdown failed', { error });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason });
  });
  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception — exiting', { error });
    void shutdown('uncaughtException');
  });
}

main().catch((error: unknown) => {
  log.error('Worker failed to start', { error });
  process.exit(1);
});
