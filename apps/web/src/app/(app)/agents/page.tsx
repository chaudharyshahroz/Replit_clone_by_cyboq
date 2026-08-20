import type { Metadata } from 'next';
import Link from 'next/link';
import { Bot } from 'lucide-react';
import { listRuns } from '@reklu/agents';
import { getAppContext } from '@/lib/auth-context';
import { StartRunForm } from '@/components/agents/start-run-form';

export const metadata: Metadata = { title: 'Agents' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, string> = {
  succeeded: 'border-success-border bg-success-subtle text-success',
  running: 'border-accent-border bg-accent-subtle text-accent',
  planning: 'border-accent-border bg-accent-subtle text-accent',
  awaiting_approval: 'border-warning/40 bg-warning/5 text-warning',
  failed: 'border-warning/40 bg-warning/5 text-warning',
  cancelled: 'border-border bg-surface-raised text-text-muted',
};

export default async function AgentsPage() {
  const { workspace } = await getAppContext();
  const runs = await listRuns(workspace.workspaceId);

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <header>
        <h1 className="display flex items-center gap-2.5 text-3xl text-text">
          <Bot className="h-7 w-7 text-accent" strokeWidth={1.5} />
          Agents
        </h1>
        <p className="mt-2 text-pretty text-text-secondary">
          Give Reklu an objective. It plans the work, then runs it step by step.
        </p>
        {/*
          Stated before the first run, not discovered during one (spec §63).
        */}
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Anything that changes data stops and asks you first, and every run has a
          step and cost ceiling it cannot exceed.
        </p>
      </header>

      <div className="mt-8">
        <StartRunForm />
      </div>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-text">Runs</h2>

        {runs.length === 0 ? (
          <p className="mt-3 rounded-xl border border-border bg-surface/40 p-6 text-sm leading-relaxed text-text-secondary">
            No runs yet. Describe an objective above and Reklu will plan it before
            doing anything.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {runs.map((run) => (
              <li key={run.id} className="rounded-xl border border-border bg-surface/40 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/agents/${run.id}`}
                    className="min-w-0 flex-1 truncate rounded text-sm text-text hover:text-accent"
                  >
                    {run.objective}
                  </Link>
                  <span
                    className={`rounded border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide ${
                      STATUS_TONE[run.status] ?? STATUS_TONE.cancelled
                    }`}
                  >
                    {run.status.replace(/_/g, ' ')}
                  </span>
                </div>

                <p className="mt-1.5 text-xs text-text-muted">
                  {run.stepsExecuted} of {run.totalSteps} steps ·{' '}
                  {new Date(run.createdAt).toLocaleString()}
                </p>

                {run.errorMessage ? (
                  <p className="mt-1.5 text-xs leading-relaxed text-warning">{run.errorMessage}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
