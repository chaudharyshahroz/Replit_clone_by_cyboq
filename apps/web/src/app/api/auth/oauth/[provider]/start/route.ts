/**
 * Begin a sign-in flow (spec §11).
 *
 * The CSRF cookie and the redirect are issued on the same response — a cookie
 * set on any other response would not exist when the callback checks it.
 */
import { NextResponse } from 'next/server';
import {
  getSignInProvider,
  isSignInProvider,
  safeReturnTo,
  signInCredentials,
  startSignIn,
} from '@reklu/auth';
import { absoluteAppUrl, logger, servedOverHttps } from '@reklu/shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE_MAX_AGE_SECONDS = 600;

function toLogin(message: string): Response {
  const url = new URL(absoluteAppUrl('/login'));
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider: raw } = await params;

  if (!isSignInProvider(raw)) {
    return toLogin('That sign-in provider is not supported.');
  }

  const credentials = signInCredentials(raw);
  if (!credentials) {
    const [id, secret] = getSignInProvider(raw).requiredEnv;
    // Naming the variables is the difference between a dead button and a
    // deployment an operator can actually fix.
    return toLogin(`${getSignInProvider(raw).displayName} sign-in is not configured (${id}, ${secret}).`);
  }

  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));
  const flow = startSignIn(raw, returnTo);

  const authorizeUrl = getSignInProvider(raw).authorizeUrl({
    credentials,
    state: flow.state,
    codeChallenge: flow.codeChallenge,
  });

  logger.info('Sign-in flow started', { provider: raw });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(flow.cookieName, flow.cookieValue, {
    httpOnly: true,
    // From APP_URL, not the request: a TLS-terminating proxy forwards plain
    // HTTP, which would silently drop this flag on an HTTPS site.
    secure: servedOverHttps(),
    // Lax, not Strict: the provider navigates the browser back cross-site.
    sameSite: 'lax',
    path: `/api/auth/oauth/${raw}`,
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
