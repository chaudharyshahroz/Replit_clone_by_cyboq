import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Globe, Lock } from 'lucide-react';
import { formatVariables, getSkill, installStatus, listVersions } from '@reklu/skills';
import { getAppContext } from '@/lib/auth-context';
import { SkillDetailPanel } from '@/components/skills/skill-detail-panel';

export const metadata: Metadata = { title: 'Skill' };
export const dynamic = 'force-dynamic';

export default async function SkillPage({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const { skillId } = await params;
  const { workspace } = await getAppContext();

  const skill = await getSkill(skillId, workspace.workspaceId);
  // Unreadable and non-existent are the same answer, so a private skill in
  // another workspace cannot be confirmed to exist by probing ids.
  if (!skill) notFound();

  const [versions, status] = await Promise.all([
    listVersions(skillId),
    installStatus(skillId, workspace.workspaceId),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-14">
      <Link
        href="/skills"
        className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
      >
        <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
        Skills
      </Link>

      <header className="mt-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="display text-2xl text-text">{skill.name}</h1>
          <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
            @{skill.handle}
          </code>
          {skill.isBuiltIn ? (
            <span className="rounded border border-accent-border bg-accent-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
              Built-in
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
            {skill.visibility === 'public' ? (
              <>
                <Globe className="h-3 w-3" strokeWidth={2} /> Public
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" strokeWidth={2} /> Private
              </>
            )}
          </span>
        </div>
        <p className="mt-2 text-text-secondary">{skill.description}</p>
        <p className="mt-1 text-xs text-text-muted">
          Invoke with <code className="text-accent">@{skill.handle}</code>
          {skill.version !== null ? ` · version ${skill.version}` : ''}
          {skill.installCount > 0 ? ` · ${skill.installCount} installs` : ''}
        </p>
      </header>

      <SkillDetailPanel
        skill={{
          id: skill.id,
          name: skill.name,
          description: skill.description,
          category: skill.category,
          instructions: skill.instructions,
          knowledge: skill.knowledge,
          variables: skill.variables,
          variablesText: formatVariables(skill.variables),
          isBuiltIn: skill.isBuiltIn,
          isOwn: skill.isOwn,
          visibility: skill.visibility,
        }}
        versions={versions.map((version) => ({
          id: version.id,
          version: version.version,
          changelog: version.changelog,
          createdAt: version.createdAt.toISOString(),
        }))}
        install={status}
      />
    </div>
  );
}
