import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-context';
import { SocialSignIn } from '@/components/auth/social-sign-in';
import { SignInForm } from './form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (await getSession()) redirect('/chat');

  const { next, error } = await searchParams;

  return (
    <div>
      <h1 className="display text-2xl text-text">Sign in to Reklu</h1>
      <p className="mt-2 text-sm text-text-secondary">Pick up where you left off.</p>

      {/*
        A failed OAuth sign-in redirects here with a readable reason — an
        expired state, a cancelled consent, an unverified provider email.
      */}
      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-warning/40 bg-warning/5 p-3 text-xs leading-relaxed text-text-secondary"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-8">
        <SignInForm next={next} />
      </div>

      <SocialSignIn returnTo={next} />

      <p className="mt-8 text-center text-sm text-text-secondary">
        New to Reklu?{' '}
        <Link href="/signup" className="rounded text-accent hover:text-accent-hover">
          Create an account
        </Link>
      </p>
    </div>
  );
}
