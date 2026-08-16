import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth-context';
import { SignInForm } from './form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (await getSession()) redirect('/home');

  const { next } = await searchParams;

  return (
    <div>
      <h1 className="display text-2xl text-text">Sign in to Reklu</h1>
      <p className="mt-2 text-sm text-text-secondary">Pick up where you left off.</p>

      <div className="mt-8">
        <SignInForm next={next} />
      </div>

      <p className="mt-8 text-center text-sm text-text-secondary">
        New to Reklu?{' '}
        <Link href="/signup" className="rounded text-accent hover:text-accent-hover">
          Create an account
        </Link>
      </p>
    </div>
  );
}
