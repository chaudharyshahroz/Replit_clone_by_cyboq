'use client';

import { useActionState } from 'react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { disconnectAction, verifyAction, type ConnectionActionState } from './actions';

/**
 * Actions on an existing connection.
 *
 * "Verify" exists because a stored row is not evidence of a working
 * connection — a token can be revoked at the provider without telling us. The
 * status shown here is the last thing the provider actually said.
 */
export function ConnectionRow({
  connectionId,
  status,
  statusDetail,
}: {
  connectionId: string;
  status: string;
  statusDetail: string | null;
}) {
  const [verifyState, verify, verifying] = useActionState<ConnectionActionState, FormData>(
    verifyAction,
    {},
  );
  const [disconnectState, disconnect, disconnecting] = useActionState<
    ConnectionActionState,
    FormData
  >(disconnectAction, {});

  const message = verifyState.message ?? disconnectState.message;
  const error = verifyState.error ?? disconnectState.error ?? statusDetail;
  const healthy = status === 'connected';

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <span
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
            healthy
              ? 'border-success/40 text-success'
              : 'border-warning/40 text-warning'
          }`}
        >
          {healthy ? (
            <Check className="h-3 w-3" strokeWidth={2.5} />
          ) : (
            <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
          )}
          {healthy ? 'Connected' : 'Needs attention'}
        </span>

        <form action={verify}>
          <input type="hidden" name="connectionId" value={connectionId} />
          <button
            type="submit"
            disabled={verifying}
            className="rounded-lg border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            {verifying ? (
              <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
            ) : (
              'Verify'
            )}
          </button>
        </form>

        <form action={disconnect}>
          <input type="hidden" name="connectionId" value={connectionId} />
          <button
            type="submit"
            disabled={disconnecting}
            className="rounded-lg border border-danger/40 px-2.5 py-1 text-xs text-danger transition-colors hover:bg-danger/5 disabled:opacity-50"
          >
            {disconnecting ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </form>
      </div>

      {message ? <p className="text-[0.6875rem] text-success">{message}</p> : null}
      {error ? (
        <p role="alert" className="max-w-xs text-right text-[0.6875rem] text-warning">
          {error}
        </p>
      ) : null}
    </div>
  );
}
