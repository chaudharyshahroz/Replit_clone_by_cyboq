import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, CircleAlert, CircleDashed } from 'lucide-react';
import { REQUIRED_SCOPES, billingDiagnostics } from '@reklu/billing';

export const metadata: Metadata = { title: 'Admin · Billing diagnostics' };
export const dynamic = 'force-dynamic';

/** Outcomes, coloured by whether they mean money reached a plan. */
const OUTCOME_TONE: Record<string, string> = {
  applied: 'border-success/40 bg-success/10 text-success',
  ignored: 'border-warning/40 bg-warning/10 text-warning',
  rejected: 'border-danger/40 bg-danger/10 text-danger',
  failed: 'border-danger/40 bg-danger/10 text-danger',
  unreadable: 'border-danger/40 bg-danger/10 text-danger',
  unhandled: 'border-border-strong text-text-muted',
};

function Verdict({ tone, children }: { tone: 'good' | 'bad' | 'unknown'; children: React.ReactNode }) {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'bad' ? CircleAlert : CircleDashed;
  const colour =
    tone === 'good' ? 'text-success' : tone === 'bad' ? 'text-danger' : 'text-text-muted';

  return (
    <p className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-text-secondary">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${colour}`} strokeWidth={2} />
      <span>{children}</span>
    </p>
  );
}

export default async function BillingDiagnosticsPage() {
  const report = await billingDiagnostics();

  const deliveriesGood = report.deliveries.some((row) => row.outcome === 'applied');
  const membershipsGood =
    report.memberships.length > 0 &&
    report.memberships.every((row) => row.resolvedWorkspaceId !== undefined);

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/admin/billing"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Billing
        </Link>
        <h2 className="display mt-2 text-xl text-text">Why a payment did not become a plan</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
          A customer paying and staying on Free has four possible causes, and they need
          four different fixes. This reads the delivery log and Whop&rsquo;s own records
          side by side to say which one it is.
        </p>
      </div>

      {/* ---- 1. Configuration --------------------------------------------- */}
      <section>
        <h3 className="text-sm font-medium text-text">1. Configuration</h3>
        <Verdict tone={report.configured ? 'good' : 'bad'}>{report.configDetail}</Verdict>
        {report.missingEnv.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {report.missingEnv.map((name) => (
              <li
                key={name}
                className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1 font-mono text-xs text-danger"
              >
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ---- 2. Is Whop reaching us? -------------------------------------- */}
      <section>
        <h3 className="text-sm font-medium text-text">2. Webhook deliveries</h3>
        <Verdict tone={deliveriesGood ? 'good' : report.deliveries.length === 0 ? 'bad' : 'unknown'}>
          {report.deliveryVerdict}
        </Verdict>

        {report.deliveries.length > 0 ? (
          <div className="mt-3 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[46rem] text-left text-sm">
              <thead className="bg-surface/60 text-xs text-text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Received</th>
                  <th className="px-4 py-2.5 font-medium">Event</th>
                  <th className="px-4 py-2.5 font-medium">Outcome</th>
                  <th className="px-4 py-2.5 font-medium">Keys Whop sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.deliveries.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-text-muted">
                      {row.receivedAt.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-secondary">
                      {row.eventType ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md border px-2 py-0.5 text-xs ${
                          OUTCOME_TONE[row.outcome] ?? 'border-border-strong text-text-muted'
                        }`}
                      >
                        {row.outcome}
                      </span>
                      {row.detail ? (
                        <span className="mt-1 block max-w-md text-xs text-text-muted">
                          {row.detail}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-text-muted">
                      {row.payloadKeys.length > 0 ? row.payloadKeys.join(', ') : '—'}
                      {row.metadataKeys.length > 0 ? (
                        <span className="mt-1 block text-text-secondary">
                          metadata: {row.metadataKeys.join(', ')}
                        </span>
                      ) : (
                        <span className="mt-1 block">metadata: none</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {/* ---- 3. What Whop actually has ------------------------------------ */}
      <section>
        <h3 className="text-sm font-medium text-text">3. Memberships at Whop</h3>
        <Verdict tone={membershipsGood ? 'good' : 'bad'}>{report.membershipVerdict}</Verdict>

        {report.memberships.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {report.memberships.map((row) => (
              <li
                key={row.membershipId}
                className={`rounded-xl border p-4 ${
                  row.resolvedWorkspaceId
                    ? 'border-border bg-surface/40'
                    : 'border-warning/40 bg-warning/5'
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-mono text-xs text-text-secondary">{row.membershipId}</span>
                  <span className="text-xs text-text-muted">{row.status}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-text">{row.verdict}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {/* ---- 4. Are plans synced? ----------------------------------------- */}
      <section>
        <h3 className="text-sm font-medium text-text">4. Plans in Whop</h3>
        <p className="mt-1.5 text-xs text-text-muted">
          A plan with no Whop id cannot be recognised on a membership bought outside
          Reklu&rsquo;s own checkout.
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-surface/60 text-xs text-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">Plan</th>
                <th className="px-4 py-2.5 font-medium">On sale</th>
                <th className="px-4 py-2.5 font-medium">Monthly id</th>
                <th className="px-4 py-2.5 font-medium">Yearly id</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.plans.map((plan) => (
                <tr key={plan.key}>
                  <td className="px-4 py-3 text-text">{plan.name}</td>
                  <td className="px-4 py-3 text-xs text-text-muted">
                    {plan.isPurchasable ? 'Yes' : 'No'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">
                    {plan.whopPlanId ?? '—'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-text-muted">
                    {plan.whopPlanIdYearly ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.plans.some((plan) => plan.whopSyncError) ? (
          <ul className="mt-3 space-y-1">
            {report.plans
              .filter((plan) => plan.whopSyncError)
              .map((plan) => (
                <li key={plan.key} className="text-xs text-danger">
                  {plan.name}: {plan.whopSyncError}
                </li>
              ))}
          </ul>
        ) : null}
      </section>

      {/* ---- 5. What the key must be allowed to do ----------------------- */}
      <section>
        <h3 className="text-sm font-medium text-text">5. API key permissions</h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-text-secondary">
          A Whop company API key is created with none of these. Without them Whop
          answers every read with 403, and a company with real paying customers reads
          back as having no memberships at all — which is what caused this page to
          exist. Grant them in Whop under Developer → API keys → your key →
          Permissions.
        </p>
        <div className="mt-3 space-y-3">
          {Object.entries(REQUIRED_SCOPES).map(([path, scopes]) => (
            <div key={path}>
              <p className="font-mono text-xs text-text-secondary">{path}</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {scopes.map((scope) => (
                  <li
                    key={scope}
                    className="rounded-md border border-border-strong px-2 py-0.5 font-mono text-xs text-text-muted"
                  >
                    {scope}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <p className="text-xs text-text-muted">
        Checkout sessions recorded: {report.sessionCount}. These are what let a payment
        be traced back to a workspace without relying on metadata.
      </p>
    </div>
  );
}
