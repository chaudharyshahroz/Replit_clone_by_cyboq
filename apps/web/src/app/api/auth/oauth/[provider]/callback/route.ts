/**
 * Complete a sign-in flow (spec §11).
 *
 * Every failure lands back on /login with a readable message. Nothing here
 * ever logs an authorization code or a token.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SIGN_IN_COOKIE_PREFIX,
  completeSignIn,
  createSession,
  getSignInProvider,
  isSignInProvider,
  signInCredentials,
  signInWithOAuth,
} from '@reklu/auth';
import { absoluteAppUrl, isRekluError, logger, servedOverHttps } from '@reklu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(message: string): Response {
  const url = new URL(absoluteAppUrl('/login'));
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider: raw } = await params;
  if (!isSignInProvider(raw)) return fail('That sign-in provider is not supported.');

  const url = new URL(request.url);

  // The user declined on the provider's screen. Not an error worth alarming them about.
  const denied = url.searchParams.get('error');
  if (denied) return fail('Sign-in was cancelled.');

  const credentials = signInCredentials(raw);
  if (!credentials) return fail(`${getSignInProvider(raw).displayName} sign-in is not configured.`);

  const jar = await cookies();
  const cookieName = `${SIGN_IN_COOKIE_PREFIX}${raw}`;

  const clear = (response: Response): Response => {
    // The one-time cookie must not survive the exchange, successful or not.
    (response as NextResponse).cookies.set(cookieName, '', {
      httpOnly: true,
      secure: servedOverHttps(),
      sameSite: 'lax',
      path: `/api/auth/oauth/${raw}`,
      maxAge: 0,
    });
    return response;
  };

  let flow;
  try {
    flow = completeSignIn({
      state: url.searchParams.get('state'),
      cookieValue: jar.get(cookieName)?.value,
      provider: raw,
    });
  } catch (error) {
    return clear(fail(error instanceof Error ? error.message : 'The sign-in state is invalid.'));
  }

  const code = url.searchParams.get('code');
  if (!code) return clear(fail('The provider returned no authorization code.'));

  try {
    const identity = await getSignInProvider(raw).exchange({
      credentials,
      code,
      codeVerifier: flow.codeVerifier,
    });

    const result = await signInWithOAuth(raw, identity);
    const sessionCookie = await createSession(result.user.id, {
      userAgent: request.headers.get('user-agent') ?? undefined,
    });

    logger.info('Signed in with an identity provider', {
      provider: raw,
      isNewUser: result.isNewUser,
      linkedExisting: result.linkedExisting,
    });

    const destination = new URL(absoluteAppUrl(flow.returnTo));
    const response = NextResponse.redirect(destination);
    response.cookies.set(sessionCookie.name, sessionCookie.value, {
      httpOnly: sessionCookie.httpOnly,
      sameSite: sessionCookie.sameSite,
      secure: sessionCookie.secure,
      path: sessionCookie.path,
      expires: sessionCookie.expires,
    });
    return clear(response);
  } catch (error) {
    if (isRekluError(error)) return clear(fail(error.userMessage));
    logger.error('Sign-in exchange failed', { provider: raw, error });
    return clear(fail('Sign-in could not be completed. Please try again.'));
  }
}
