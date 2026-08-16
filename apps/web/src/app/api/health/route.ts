/**
 * Health endpoint (spec §152).
 *
 * Reports real dependency status for load balancers and uptime checks. Returns
 * 503 when a hard dependency is down, so an unhealthy replica is actually
 * removed from rotation rather than quietly serving errors.
 *
 * Deliberately exposes no configuration values — only whether things work.
 */
import { NextResponse } from 'next/server';
import { checkDatabaseHealth } from '@reklu/database';
import { checkQueueHealth } from '@reklu/queue';
import { features, loadServerEnv } from '@reklu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  const [database, queue] = await Promise.all([
    checkDatabaseHealth(),
    checkQueueHealth().catch(() => ({ ok: false, latencyMs: 0, error: 'unreachable' })),
  ]);

  const available = features();
  const env = loadServerEnv();

  // Postgres is required to serve anything. Redis only gates background work,
  // so its absence is degraded rather than dead.
  const healthy = database.ok;
  const degraded = healthy && !queue.ok;

  const body = {
    status: healthy ? (degraded ? 'degraded' : 'ok') : 'unhealthy',
    version: process.env.npm_package_version ?? '0.1.0',
    checks: {
      database: {
        ok: database.ok,
        latencyMs: database.latencyMs,
        vectorEnabled: database.vectorEnabled,
      },
      queue: { ok: queue.ok, latencyMs: queue.latencyMs },
    },
    capabilities: {
      modelProvider: available.anyModelProvider,
      embeddings: available.embeddings,
      webSearch: available.webSearch,
      durableStorage: available.durableStorage,
      isolatedSandbox: available.isolatedSandbox,
      build: available.build,
      billing: available.billing,
    },
    environment: env.NODE_ENV,
    checkedInMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, {
    status: healthy ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
