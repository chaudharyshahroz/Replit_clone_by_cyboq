/**
 * HTTP helpers shared by every provider adapter.
 *
 * Centralised so that three things are true of every provider call without
 * each adapter remembering them: requests time out, failures carry the
 * provider and status, and **no response body containing a token is ever
 * logged or embedded in an error message**.
 */
import { IntegrationError } from './types';

const DEFAULT_TIMEOUT_MS = 15_000;

/** Reklu identifies itself; several providers rate-limit anonymous clients harder. */
const USER_AGENT = 'Reklu/0.1 (+https://reklu.app)';

async function request(
  provider: string,
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new IntegrationError(provider, `Could not reach ${provider}: ${reason}`);
  }
  return response;
}

/**
 * A token-endpoint call.
 *
 * The body is deliberately never included in the error: token responses carry
 * credentials even when the status is an error, and an exception message ends
 * up in logs.
 */
export async function postForToken(
  provider: string,
  url: string,
  body: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const response = await request(provider, url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...extraHeaders,
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!response.ok) {
    throw new IntegrationError(
      provider,
      `${provider} rejected the authorization code (HTTP ${response.status}).`,
      response.status,
    );
  }

  const parsed = (await response.json().catch(() => undefined)) as
    | Record<string, unknown>
    | undefined;
  if (!parsed) throw new IntegrationError(provider, `${provider} returned a malformed token response.`);

  // Some providers answer 200 with an error payload rather than a 4xx.
  if (typeof parsed.error === 'string') {
    const description =
      typeof parsed.error_description === 'string' ? parsed.error_description : parsed.error;
    throw new IntegrationError(provider, `${provider} refused the exchange: ${description}`);
  }

  return parsed;
}

/** An authenticated GET against a provider's API. */
export async function getJson<T>(
  provider: string,
  url: string,
  accessToken: string,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const response = await request(provider, url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...extraHeaders,
    },
  });

  if (!response.ok) {
    throw new IntegrationError(
      provider,
      `${provider} API returned HTTP ${response.status}.`,
      response.status,
    );
  }
  return (await response.json()) as T;
}

/** Whether a token is currently accepted. Never throws — the caller wants a fact. */
export async function tokenWorks(
  provider: string,
  url: string,
  accessToken: string,
  extraHeaders: Record<string, string> = {},
): Promise<boolean> {
  try {
    await getJson(provider, url, accessToken, extraHeaders);
    return true;
  } catch {
    return false;
  }
}

/** Providers report granted scopes as a space- or comma-separated string. */
export function parseScopes(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/** `expires_in` is seconds from now; absent means a non-expiring token. */
export function expiryFrom(raw: unknown, now = Date.now()): Date | undefined {
  const seconds = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return new Date(now + seconds * 1000);
}
