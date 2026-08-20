import type { Metadata } from 'next';
import Link from 'next/link';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { Sparkles } from 'lucide-react';
import { db, skills, skillVersions } from '@reklu/database';
import { getAppContext } from '@/lib/auth-context';
import { SkillEditor } from '@/components/skills/skill-editor';

export const metadata: Metadata = { title: 'Skills' };

const CATEGORY_LABEL: Record<string, string> = {
  development: 'Development',
  design: 'Design',
  research: 'Research',
  marketing: 'Marketing',
  sales: 'Sales',
  productivity: 'Productivity',
  data: 'Data',
  finance: 'Finance',
  writing: 'Writing',
  other: 'Other',
};

export default async function SkillsPage() {
  const { workspace } = await getAppContext();

  const rows = await db
    .select({
      id: skills.id,
      handle: skills.handle,
      name: skills.name,
      description: skills.description,
      category: skills.category,
      isBuiltIn: skills.isBuiltIn,
      instructions: skillVersions.instructions,
      version: skillVersions.version,
      preferredModelKey: skillVersions.preferredModelKey,
    })
    .from(skills)
    .leftJoin(skillVersions, eq(skills.currentVersionId, skillVersions.id))
    .where(
      and(
        isNull(skills.deletedAt),
        // Built-ins have no workspace; a workspace never sees another's skills.
        or(isNull(skills.workspaceId), eq(skills.workspaceId, workspace.workspaceId)),
      ),
    )
    .orderBy(asc(skills.category), asc(skills.name));

  const byCategory = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-14">
      <header>
        <h1 className="display text-3xl text-text">Skills</h1>
        <p className="mt-2 max-w-2xl text-text-secondary">
          Reusable AI expertise: instructions, worked examples, attached knowledge, a preferred
          model, and the tools a skill is allowed to use.
        </p>

        <div className="mt-6">
          <SkillEditor />
        </div>
      </header>

      {rows.length === 0 ? (
        // Spec §90 — a useful empty state, not a blank page.
        <div className="mt-12 rounded-xl border border-border bg-surface/40 p-10 text-center">
          <Sparkles className="mx-auto h-5 w-5 text-text-muted" strokeWidth={1.5} />
          <p className="mt-4 text-sm text-text">No Skills yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
            Create your own with the button above, or run <code>pnpm db:seed</code> to load the
            built-in library.
          </p>
        </div>
      ) : (
        <div className="mt-12 space-y-10">
          {[...byCategory.entries()].map(([category, items]) => (
            <section key={category}>
              <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
                {CATEGORY_LABEL[category] ?? category}
              </h2>

              <ul className="mt-4 space-y-3">
                {items.map((skill) => (
                  <li
                    key={skill.id}
                    className="rounded-xl border border-border bg-surface/40 p-5 transition-colors hover:border-border-strong"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/skills/${skill.id}`}
                        className="rounded text-sm font-medium text-text hover:text-accent"
                      >
                        {skill.name}
                      </Link>
                      <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[0.6875rem] text-text-muted">
                        @{skill.handle}
                      </code>
                      {skill.isBuiltIn ? (
                        <span className="rounded border border-accent-border bg-accent-subtle px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-accent">
                          Built-in
                        </span>
                      ) : null}
                      {skill.version ? (
                        <span className="ml-auto font-mono text-[0.6875rem] text-text-muted">
                          v{skill.version}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-2 text-sm text-text-secondary">{skill.description}</p>

                    {skill.instructions ? (
                      <details className="group mt-3">
                        <summary className="cursor-pointer rounded text-xs text-text-muted transition-colors hover:text-text-secondary">
                          Instructions
                        </summary>
                        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-canvas p-4 font-mono text-[0.75rem] leading-relaxed text-text-secondary">
                          {skill.instructions}
                        </pre>
                      </details>
                    ) : null}

                    {skill.preferredModelKey ? (
                      <p className="mt-3 text-[0.6875rem] text-text-muted">
                        Prefers <span className="font-mono">{skill.preferredModelKey}</span>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
