import type { Metadata } from 'next';
import { listPlans, listUsers } from '@/lib/admin-data';
import { UserTable } from '@/components/admin/user-table';

export const metadata: Metadata = { title: 'Admin · Users' };
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const [rows, planList] = await Promise.all([
    listUsers({ query: q, limit: 100 }),
    listPlans(),
  ]);

  return (
    <div className="space-y-4">
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search by email or name"
          aria-label="Search users"
          className="w-full max-w-sm rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text hover:bg-surface-hover"
        >
          Search
        </button>
      </form>

      <p className="text-xs text-text-muted">
        {rows.length} {rows.length === 1 ? 'account' : 'accounts'}
        {q ? ` matching “${q}”` : ''}
      </p>

      <UserTable
        plans={planList.map((plan) => ({ key: plan.key, name: plan.name }))}
        rows={rows.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          isSuperAdmin: row.isSuperAdmin,
          suspended: row.suspendedAt !== null,
          verified: row.emailVerified !== null,
          planName: row.planName,
          planKey: row.planKey,
          workspaceId: row.workspaceId,
          workspaceName: row.workspaceName,
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
