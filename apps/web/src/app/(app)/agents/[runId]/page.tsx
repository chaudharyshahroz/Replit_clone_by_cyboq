import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getRun } from '@reklu/agents';
import { getAppContext } from '@/lib/auth-context';
import { RunPanel } from '@/components/agents/run-panel';

export const metadata: Metadata = { title: 'Agent run' };
export const dynamic = 'force-dynamic';

export default async function AgentRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const { workspace } = await getAppContext();

  const run = await getRun(runId, workspace.workspaceId);
  if (!run) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Agents
      </Link>

      <header className="mt-4">
        <h1 className="text-pretty text-xl leading-snug text-text">{run.objective}</h1>
        <p className="mt-2 text-xs text-text-muted">
          {run.stepsExecuted} of {run.totalSteps} steps · ceiling {run.maxSteps} steps ·
          budget ${run.maxCostUsd}
        </p>
      </header>

      <RunPanel
        run={{
          id: run.id,
          status: run.status,
          stepsExecuted: run.stepsExecuted,
          totalSteps: run.totalSteps,
          errorMessage: run.errorMessage,
        }}
        steps={run.steps.map((step) => ({
          id: step.id,
          stepIndex: step.stepIndex,
          title: step.title,
          description: step.description,
          kind: step.kind,
          toolName: step.toolName,
          status: step.status,
          output: typeof step.output === 'string' ? step.output : null,
          errorMessage: step.errorMessage,
        }))}
        approval={
          run.pendingApproval
            ? {
                id: run.pendingApproval.id,
                action: run.pendingApproval.action,
                reason: run.pendingApproval.reason,
                riskClass: run.pendingApproval.riskClass,
                // Rendered so the person sees exactly what will run.
                payload: JSON.stringify(run.pendingApproval.payload ?? {}, null, 2),
                expiresAt: run.pendingApproval.expiresAt?.toISOString() ?? null,
              }
            : null
        }
      />
    </div>
  );
}
