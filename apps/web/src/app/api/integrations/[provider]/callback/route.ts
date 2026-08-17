/**
 * OAuth callback.
 *
 * Validates the state against the cookie set when the flow began, exchanges the
 * code, and stores the connection with the token encrypted.
 *
 * Every failure path redirects back into the app with a readable message rather
 * than rendering raw JSON: the user arrives here from a provider's consent
 * screen, and a wall of JSON is a dead end. Nothing here ever echoes the
 * authorization code or a token into a URL, a log, or an error page.
 */
import { NextResponse } from 'next/server';
import {
  OAUTH_COOKIE_PREFIX,
  completeFlow,
  credentialsFor,
  getProvider,
  isIntegrationProvider,
  saveConnection,
} from '@reklu/integrations';
import { absoluteAppUrl, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(_request: Request, message: string, returnTo = '/settings/connections'): Response {
  const url = new URL(absoluteAppUrl(returnTo));
  url.searchParams.set('error', message);
  return NextResponse.redirect(url);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider: raw } = await params;
  if (!isIntegrationProvider(raw)) {
    return NextResponse.json({ error: `Unknown integration "${raw}".` }, { status: 404 });
  }

  const provider = getProvider(raw);
  const url = new URL(request.url);
  const cookieName = `${OAUTH_COOKIE_PREFIX}${raw}`;

  const clearCookie = (response: Response): Response => {
    // Single use: the state cookie is spent whether or not the flow succeeded.
    (response as NextResponse).cookies.set(cookieName, '', {
      httpOnly: true,
      path: `/api/integrations/${raw}`,
      maxAge: 0,
    });
    return response;
  };

  // The user pressed Cancel, or the provider refused. This is not an error
  // worth alarming anyone about.
  const providerError = url.searchParams.get('error');
  if (providerError) {
    const description = url.searchParams.get('error_description') ?? providerError;
    logger.info('OAuth flow declined', { provider: raw, reason: providerError });
    return clearCookie(fail(request, `${provider.displayName} authorization was cancelled: ${description}`));
  }

  const { workspace } = await getAppContext();

  let flow;
  try {
    flow = completeFlow({
      state: url.searchParams.get('state'),
      cookieValue: request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1),
      provider: raw,
    });
  } catch (error) {
    logger.warn('OAuth state rejected', {
      provider: raw,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return clearCookie(
      fail(request, error instanceof Error ? error.message : 'The authorization could not be verified.'),
    );
  }

  /**
   * The state proves which workspace started the flow. If the active workspace
   * has changed since — another tab switched it — storing the connection in the
   * current one would silently attach an account to the wrong tenant.
   */
  if (flow.workspaceId !== workspace.workspaceId) {
    return clearCookie(
      fail(request, 'This authorization was started in a different workspace. Try connecting again.'),
    );
  }

  const code = url.searchParams.get('code');
  if (!code) return clearCookie(fail(request, 'The provider returned no authorization code.'));

  const credentials = credentialsFor(raw);
  if (!credentials) {
    return clearCookie(fail(request, `${provider.displayName} is no longer configured on this instance.`));
  }

  try {
    const tokens = await provider.exchangeCode({
      credentials,
      code,
      codeVerifier: provider.usesPkce ? flow.codeVerifier : undefined,
    });
    const account = await provider.identify(tokens.accessToken);

    await saveConnection({
      provider: raw,
      workspaceId: flow.workspaceId,
      userId: flow.userId,
      tokens,
      account,
    });

    const success = new URL(absoluteAppUrl(flow.returnTo));
    success.searchParams.set('connected', raw);
    return clearCookie(NextResponse.redirect(success));
  } catch (error) {
    // The message is logged, never the code or any token.
    logger.error('OAuth exchange failed', {
      provider: raw,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return clearCookie(
      fail(request, `Could not complete the ${provider.displayName} connection. Please try again.`, flow.returnTo),
    );
  }
}
