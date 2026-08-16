/**
 * Begin an OAuth authorization (spec §37–§39).
 *
 * Sets the CSRF/PKCE cookie and redirects to the provider's consent screen. The
 * cookie and the redirect must be issued on the same response, or the callback
 * has nothing to compare the state against.
 */
import { NextResponse } from 'next/server';
import {
  credentialsFor,
  describeProvider,
  getProvider,
  isIntegrationProvider,
  safeReturnTo,
  startFlow,
} from '@reklu/integrations';
import { logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The flow must finish promptly; the state carries the same 10-minute limit. */
const COOKIE_MAX_AGE_SECONDS = 600;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider: raw } = await params;

  if (!isIntegrationProvider(raw)) {
    return NextResponse.json({ error: `Unknown integration "${raw}".` }, { status: 404 });
  }

  const { user, workspace } = await getAppContext();

  // Unconfigured is an operator problem, not a user error: name the variables
  // rather than showing a generic failure (spec §25).
  const credentials = credentialsFor(raw);
  if (!credentials) {
    const { missingEnv } = describeProvider(raw);
    return NextResponse.json(
      {
        error: `${getProvider(raw).displayName} is not configured on this instance.`,
        requiredEnv: missingEnv,
      },
      { status: 503 },
    );
  }

  const returnTo = safeReturnTo(new URL(request.url).searchParams.get('returnTo'));

  const flow = startFlow({
    provider: raw,
    workspaceId: workspace.workspaceId,
    userId: user.id,
    returnTo,
  });

  const provider = getProvider(raw);
  const authorizeUrl = provider.authorizeUrl({
    credentials,
    state: flow.state,
    // Only providers that implement PKCE are given a challenge; sending one to
    // a provider that ignores it would be harmless but misleading.
    codeChallenge: provider.usesPkce ? flow.codeChallenge : undefined,
  });

  logger.info('OAuth flow started', { provider: raw, workspaceId: workspace.workspaceId });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(flow.cookieName, flow.cookieValue, {
    httpOnly: true,
    secure: new URL(request.url).protocol === 'https:',
    // Lax, not Strict: the provider redirects the browser back to us
    // cross-site, and Strict would withhold the cookie on that navigation.
    sameSite: 'lax',
    path: `/api/integrations/${raw}`,
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
