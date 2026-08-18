'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { safeNext } from '@/lib/safe-next';
import {
  authenticate,
  createSession,
  clearedSessionCookie,
  registerUser,
  revokeSession,
  SESSION_COOKIE,
} from '@reklu/auth';
import { isRekluError, logger } from '@reklu/shared';

export interface AuthFormState {
  readonly error?: string;
  readonly fieldErrors?: Record<string, string[]>;
}


async function requestContext() {
  const headerList = await headers();
  return {
    userAgent: headerList.get('user-agent') ?? undefined,
    // Trust the first hop only; the rest of XFF is attacker-controllable.
    ipAddress: headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  };
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const name = String(formData.get('name') ?? '');
  const next = safeNext(formData.get('next'));

  try {
    const { user } = await registerUser({ email, password, name: name || undefined });
    const cookie = await createSession(user.id, await requestContext());
    (await cookies()).set(cookie);
    logger.info('User registered', { userId: user.id });
  } catch (error) {
    if (isRekluError(error)) {
      return {
        error: error.userMessage,
        fieldErrors: (error.context.fieldErrors as Record<string, string[]>) ?? undefined,
      };
    }
    logger.error('Registration failed', { error });
    return { error: 'We could not create your account. Please try again.' };
  }

  // redirect() throws, so it must sit outside the try or it is caught as an error.
  redirect(next);
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = safeNext(formData.get('next'));

  try {
    const user = await authenticate(email, password);
    if (!user) {
      // One message for every failure mode: a distinct "no such account"
      // response would turn this form into an account-enumeration oracle.
      return { error: 'That email or password is not correct.' };
    }
    const cookie = await createSession(user.id, await requestContext());
    (await cookies()).set(cookie);
    logger.info('User signed in', { userId: user.id });
  } catch (error) {
    logger.error('Sign-in failed', { error });
    return { error: 'We could not sign you in. Please try again.' };
  }

  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const store = await cookies();
  await revokeSession(store.get(SESSION_COOKIE)?.value);
  store.set(clearedSessionCookie());
  redirect('/');
}
