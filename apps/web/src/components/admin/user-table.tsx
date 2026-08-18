'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, ShieldOff, ShieldPlus, UserX } from 'lucide-react';
import {
  readUserContent,
  setSuperAdmin,
  setUserSuspended,
  type AdminActionState,
  type UserContentResult,
} from '@/app/(app)/admin/actions';

interface Row {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly isSuperAdmin: boolean;
  readonly suspended: boolean;
  readonly verified: boolean;
  readonly planName: string | null;
  readonly workspaceName: string | null;
  readonly lastSeenAt: string | null;
  readonly createdAt: string;
}

export function UserTable({ rows }: { rows: readonly Row[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** The user whose content is being requested, and the reason typed so far. */
  const [viewing, setViewing] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [content, setContent] = useState<UserContentResult | null>(null);

  const act = (fn: () => Promise<AdminActionState>): void => {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      setError(result.error ?? null);
      setNotice(result.notice ?? null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary">
          {notice}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <caption className="sr-only">Accounts with plan, status and administrative controls</caption>
          <thead>
            <tr className="bg-surface-raised text-left text-[11px] uppercase tracking-wider text-text-muted">
              <th scope="col" className="px-3 py-2 font-medium">Account</th>
              <th scope="col" className="px-3 py-2 font-medium">Plan</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 font-medium">Last seen</th>
              <th scope="col" className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border bg-surface">
                <td className="px-3 py-2.5">
                  <span className="block text-text">{row.name ?? '—'}</span>
                  <span className="block text-xs text-text-muted">{row.email}</span>
                </td>
                <td className="px-3 py-2.5 text-text-secondary">{row.planName ?? 'Free'}</td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap gap-1">
                    {row.suspended ? <Tag tone="warn">suspended</Tag> : <Tag tone="ok">active</Tag>}
                    {row.isSuperAdmin ? <Tag tone="accent">admin</Tag> : null}
                    {!row.verified ? <Tag tone="muted">unverified</Tag> : null}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-text-muted">
                  {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleDateString() : 'never'}
                </td>
                <td className="px-3 py-2.5">
                  <span className="flex flex-wrap gap-1.5">
                    <IconButton
                      label={row.suspended ? 'Reinstate' : 'Suspend'}
                      disabled={pending}
                      onClick={() => act(() => setUserSuspended(row.id, !row.suspended))}
                    >
                      <UserX className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </IconButton>

                    <IconButton
                      label={row.isSuperAdmin ? 'Revoke admin' : 'Make admin'}
                      disabled={pending}
                      onClick={() => act(() => setSuperAdmin(row.id, !row.isSuperAdmin))}
                    >
                      {row.isSuperAdmin ? (
                        <ShieldOff className="h-3.5 w-3.5" strokeWidth={1.75} />
                      ) : (
                        <ShieldPlus className="h-3.5 w-3.5" strokeWidth={1.75} />
                      )}
                    </IconButton>

                    <IconButton
                      label="View conversations"
                      disabled={pending}
                      onClick={() => {
                        setViewing(row);
                        setReason('');
                        setContent(null);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </IconButton>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        The gate on private content. A reason is required and recorded, so the
        audit trail says why someone looked rather than only that they did.
      */}
      {viewing ? (
        <div className="rounded-xl border border-warning/40 bg-warning/5 p-5">
          <h2 className="text-sm font-medium text-text">
            Read {viewing.email}&rsquo;s conversations
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            This is private content. Your name, the time and the reason below are
            written to the audit log before anything is shown.
          </p>

          <label className="mt-3 block">
            <span className="text-xs font-medium text-text">Why do you need this?</span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Investigating a support ticket about missing history"
              className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:border-accent"
            />
          </label>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length < 10}
              onClick={() =>
                startTransition(async () => {
                  setContent(await readUserContent(viewing.id, reason));
                })
              }
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              Record and show
            </button>
            <button
              type="button"
              onClick={() => {
                setViewing(null);
                setContent(null);
              }}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>

          {content?.error ? (
            <p role="alert" className="mt-3 text-xs text-warning">{content.error}</p>
          ) : null}

          {content?.conversations ? (
            content.conversations.length === 0 ? (
              <p className="mt-4 text-xs text-text-muted">This account has no conversations.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {content.conversations.map((conversation) => (
                  <li key={conversation.id} className="rounded-lg border border-border bg-surface p-3">
                    <p className="text-xs font-medium text-text">{conversation.title}</p>
                    <p className="text-[11px] text-text-muted">
                      {new Date(conversation.createdAt).toLocaleString()}
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {conversation.messages.map((message, index) => (
                        <li key={index} className="text-[11px] leading-relaxed text-text-secondary">
                          <span className="font-mono uppercase text-text-muted">{message.role}</span>{' '}
                          {message.text}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Tag({ tone, children }: { tone: 'ok' | 'warn' | 'accent' | 'muted'; children: string }) {
  const tones = {
    ok: 'border-success-border bg-success-subtle text-success',
    warn: 'border-warning/40 bg-warning/5 text-warning',
    accent: 'border-accent-border bg-accent-subtle text-accent',
    muted: 'border-border bg-surface-raised text-text-muted',
  } as const;

  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-hover disabled:opacity-50"
    >
      {children}
    </button>
  );
}
