import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { features } from '@reklu/shared';
import { getSession } from '@/lib/auth-context';
import { SignUpForm } from './form';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getSession()) redirect('/home');

  const { next } = await searchParams;
  const available = features();

  return (
    <div>
      <h1 className="display text-2xl text-text">Create your account</h1>
      <p className="mt-2 text-sm text-text-secondary">
        One workspace for research, creation and building.
      </p>

      <div className="mt-8">
        <SignUpForm next={next} />
      </div>

      {/*
        Spec §111/§137: an unconfigured provider is stated honestly rather than
        rendered as a button that cannot work.
      */}
      {!available.googleSignIn && !available.githubSignIn ? (
        <p className="mt-6 rounded-lg border border-border bg-surface/50 p-3 text-xs leading-relaxed text-text-muted">
          Google and GitHub sign-in are not configured on this instance. Set{' '}
          <code className="text-text-secondary">AUTH_GOOGLE_ID</code> or{' '}
          <code className="text-text-secondary">AUTH_GITHUB_ID</code> to enable them.
        </p>
      ) : null}

      <p className="mt-8 text-center text-sm text-text-secondary">
        Already have an account?{' '}
        <Link href="/login" className="rounded text-accent hover:text-accent-hover">
          Sign in
        </Link>
      </p>
    </div>
  );
}
