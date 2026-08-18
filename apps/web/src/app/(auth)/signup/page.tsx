import type { Metadata } from 'next';
import Link from 'next/link';
import { SocialSignIn } from '@/components/auth/social-sign-in';
import { redirect } from 'next/navigation';
import { features } from '@reklu/shared';
import { getSession } from '@/lib/auth-context';
import { safeNext } from '@/lib/safe-next';
import { SignUpForm } from './form';

export const metadata: Metadata = { title: 'Create your account' };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  /**
   * An already-signed-in visitor still goes where they were heading.
   * Redirecting to /home instead would silently discard the question someone
   * typed on the landing page, which is the one thing this flow exists to
   * preserve.
   */
  if (await getSession()) redirect(safeNext(next));
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

      <SocialSignIn />

      <p className="mt-8 text-center text-sm text-text-secondary">
        Already have an account?{' '}
        <Link href="/login" className="rounded text-accent hover:text-accent-hover">
          Sign in
        </Link>
      </p>
    </div>
  );
}
