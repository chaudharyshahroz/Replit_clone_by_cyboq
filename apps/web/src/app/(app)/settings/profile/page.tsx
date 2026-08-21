import type { Metadata } from 'next';
import { User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getAppContext } from '@/lib/auth-context';
import { signOutAction } from '@/app/(auth)/actions';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const { user, workspace } = await getAppContext();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 md:px-8">
      <header>
        <h1 className="display flex items-center gap-2.5 text-2xl text-text">
          <User className="h-6 w-6 text-accent" strokeWidth={1.5} />
          Profile
        </h1>
        <p className="mt-1.5 text-sm text-text-secondary">
          Who you are signed in as.
        </p>
      </header>

      <dl className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
        {[
          ['Name', user.name ?? '—'],
          ['Email', user.email],
          ['Email verified', user.emailVerified ? 'Yes' : 'Not yet'],
          ['Workspace', `${workspace.workspaceName} (${workspace.role})`],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 bg-surface/40 px-5 py-3.5"
          >
            <dt className="text-sm text-text-secondary">{label}</dt>
            <dd className="truncate text-sm text-text">{value}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-text">Sign out</h2>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-text-secondary">
          Ends this session on this device. Anything you have sent stays in your
          workspace.
        </p>
        <form action={signOutAction} className="mt-3">
          <Button type="submit" variant="secondary" size="sm">
            Sign out
          </Button>
        </form>
      </section>
    </div>
  );
}
