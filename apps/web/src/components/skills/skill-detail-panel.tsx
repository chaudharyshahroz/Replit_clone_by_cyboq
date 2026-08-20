'use client';

import { useActionState, useState, useTransition } from 'react';
import { Globe, History, Loader2, Lock, PencilLine, RotateCcw } from 'lucide-react';
import {
  reviseSkillAction,
  rollbackSkillAction,
  setVisibilityAction,
  upgradeInstallAction,
  type SkillFormState,
} from '@/app/(app)/skills/actions';

interface SkillSummary {
  /**
   * Pre-formatted by the server. Importing the skills package here would pull
   * its database modules into the browser bundle — the panel needs the text,
   * not the code that produces it.
   */
  readonly variablesText: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly instructions: string;
  readonly knowledge: string | null;
  readonly variables: readonly { name: string; description?: string; required?: boolean }[];
  readonly isBuiltIn: boolean;
  readonly isOwn: boolean;
  readonly visibility: string;
}

interface VersionRow {
  readonly id: string;
  readonly version: number;
  readonly changelog: string | null;
  readonly createdAt: string;
}

interface InstallState {
  readonly installed: boolean;
  readonly pinnedVersion: number | null;
  readonly currentVersion: number | null;
  readonly upgradeAvailable: boolean;
}

/**
 * Edit, history and visibility for one skill.
 *
 * Editing never mutates a version — it publishes a new one, and rollback
 * publishes a new version carrying the old content. The history below is
 * therefore always the whole truth, which is why it can be shown plainly.
 */
export function SkillDetailPanel({
  skill,
  versions,
  install,
}: {
  skill: SkillSummary;
  versions: readonly VersionRow[];
  install: InstallState;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  const [state, action, saving] = useActionState<SkillFormState, FormData>(
    reviseSkillAction.bind(null, skill.id),
    {},
  );

  const editable = skill.isOwn && !skill.isBuiltIn;

  const run = (fn: () => Promise<SkillFormState>): void => {
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      setNotice(result.error ?? null);
    });
  };

  return (
    <div className="mt-8 space-y-6">
      {notice ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          {notice}
        </p>
      ) : null}

      {/* ---- Pinned version, when installed from someone else ------------- */}
      {install.installed && install.upgradeAvailable ? (
        <section className="rounded-xl border border-accent-border bg-accent-subtle p-4">
          <p className="text-sm text-text">
            You are running version {install.pinnedVersion}. Version{' '}
            {install.currentVersion} is available.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            Upgrading is deliberate — your version does not change until you choose it.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => upgradeInstallAction(skill.id))}
            className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
          >
            Upgrade to v{install.currentVersion}
          </button>
        </section>
      ) : null}

      {/* ---- Instructions / editor --------------------------------------- */}
      <section className="rounded-xl border border-border bg-surface/40 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-text">Instructions</h2>
          {editable ? (
            <button
              type="button"
              onClick={() => setEditing((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text hover:bg-surface-hover"
            >
              <PencilLine className="h-3.5 w-3.5" strokeWidth={1.75} />
              {editing ? 'Cancel' : 'Edit'}
            </button>
          ) : null}
        </div>

        {!editable ? (
          <p className="mt-2 text-xs text-text-muted">
            {skill.isBuiltIn
              ? 'Built-in skills cannot be edited. Duplicate it to make your own version.'
              : 'This skill belongs to another workspace. Install or duplicate it to use it.'}
          </p>
        ) : null}

        {editing && editable ? (
          <form action={action} className="mt-4 grid gap-4">
            {state.error ? (
              <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
                {state.error}
              </p>
            ) : null}

            <input type="hidden" name="category" value={skill.category} />

            <label className="block">
              <span className="text-xs font-medium text-text">Name</span>
              <input
                name="name"
                required
                minLength={3}
                defaultValue={skill.name}
                className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-text">Description</span>
              <input
                name="description"
                required
                minLength={10}
                defaultValue={skill.description}
                className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-text">Instructions</span>
              <textarea
                name="instructions"
                required
                minLength={20}
                rows={8}
                defaultValue={skill.instructions}
                className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none focus:border-accent"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-text">Reference material</span>
              <textarea
                name="knowledge"
                rows={4}
                defaultValue={skill.knowledge ?? ''}
                className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none focus:border-accent"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-text">Variables</span>
              <span className="ml-2 text-[0.6875rem] text-text-muted">
                One per line. <code>name* — description</code>; the asterisk marks it required.
              </span>
              <textarea
                name="variables"
                rows={3}
                defaultValue={skill.variablesText}
                placeholder={'topic* — what to write about\naudience — who reads it'}
                className="mt-1.5 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-text outline-none placeholder:text-text-muted focus:border-accent"
              />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-text">What changed</span>
              <input
                name="changelog"
                placeholder="Tightened the summary format"
                className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:border-accent"
              />
            </label>

            <p className="text-[0.6875rem] leading-relaxed text-text-muted">
              Saving publishes a new version. Anyone running an earlier version keeps
              it until they upgrade.
            </p>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-fit items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> : null}
              {saving ? 'Publishing…' : 'Publish new version'}
            </button>
          </form>
        ) : (
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-surface p-3 font-mono text-xs leading-relaxed text-text-secondary">
            {skill.instructions || 'No instructions.'}
          </pre>
        )}

        {!editing && skill.variables.length > 0 ? (
          <div className="mt-4">
            <h3 className="text-xs font-medium text-text">Variables</h3>
            <ul className="mt-2 space-y-1">
              {skill.variables.map((variable) => (
                <li key={variable.name} className="text-xs text-text-secondary">
                  <code className="text-accent">{variable.name}</code>
                  {variable.required ? (
                    <span className="ml-1.5 text-[0.625rem] uppercase tracking-wide text-warning">
                      required
                    </span>
                  ) : null}
                  {variable.description ? ` — ${variable.description}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {/* ---- Visibility --------------------------------------------------- */}
      {editable ? (
        <section className="rounded-xl border border-border bg-surface/40 p-5">
          <h2 className="text-sm font-medium text-text">Visibility</h2>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            {skill.visibility === 'public'
              ? 'Anyone can find and install this skill. Withdrawing it removes it from the library; existing installs keep working.'
              : 'Only your workspace can see this skill.'}
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() => setVisibilityAction(skill.id, skill.visibility !== 'public'))
            }
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-text hover:bg-surface-hover disabled:opacity-60"
          >
            {skill.visibility === 'public' ? (
              <>
                <Lock className="h-3.5 w-3.5" strokeWidth={1.75} /> Make private
              </>
            ) : (
              <>
                <Globe className="h-3.5 w-3.5" strokeWidth={1.75} /> Publish to the library
              </>
            )}
          </button>
        </section>
      ) : null}

      {/* ---- History ------------------------------------------------------ */}
      <section className="rounded-xl border border-border bg-surface/40 p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text">
          <History className="h-4 w-4 text-text-muted" strokeWidth={1.75} />
          Version history
        </h2>

        {versions.length === 0 ? (
          <p className="mt-3 text-xs text-text-muted">No versions recorded.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
            {versions.map((version, index) => (
              <li
                key={version.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-surface px-3 py-2.5"
              >
                <span className="font-mono text-xs text-text">v{version.version}</span>
                {index === 0 ? (
                  <span className="rounded border border-accent-border bg-accent-subtle px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wide text-accent">
                    Current
                  </span>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">
                  {version.changelog ?? '—'}
                </span>
                <span className="text-[0.6875rem] text-text-muted">
                  {new Date(version.createdAt).toLocaleDateString()}
                </span>
                {editable && index !== 0 ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => rollbackSkillAction(skill.id, version.id))}
                    className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[0.6875rem] text-text-secondary hover:bg-surface-hover disabled:opacity-60"
                  >
                    <RotateCcw className="h-3 w-3" strokeWidth={2} />
                    Restore
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[0.6875rem] leading-relaxed text-text-muted">
          Restoring publishes a new version carrying the older content, so the
          history stays complete.
        </p>
      </section>
    </div>
  );
}
