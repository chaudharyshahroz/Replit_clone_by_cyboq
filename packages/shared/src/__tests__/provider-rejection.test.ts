/**
 * When the provider is the one refusing.
 *
 * Selecting a model produced "Something failed on our side" — a message that is
 * correct about nothing. The provider had answered with a specific, actionable
 * sentence, and it was being replaced by the one message guaranteed to send
 * somebody to a server log that does not have the answer either, because the
 * failure was not ours.
 */
import { describe, expect, it } from 'vitest';
import { toRekluError } from '../errors';

function apiCallError(params: {
  status: number;
  body?: string;
  url?: string;
  message?: string;
}): Error {
  return Object.assign(new Error(params.message ?? 'call failed'), {
    name: 'AI_APICallError',
    statusCode: params.status,
    responseBody: params.body,
    url: params.url ?? 'https://openrouter.ai/api/v1/chat/completions',
  });
}

describe('a provider rejection', () => {
  it('shows what the provider actually said', () => {
    /*
     * The real one behind free models on OpenRouter: the account has not
     * accepted the data policy those models are served under. Nothing about
     * Reklu is wrong, and no amount of reading Reklu's logs would say so.
     */
    const error = toRekluError(
      apiCallError({
        status: 404,
        body: JSON.stringify({
          error: { message: 'No endpoints found matching your data policy (Free model publication).' },
        }),
      }),
    );

    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.userMessage).toContain('data policy');
    expect(error.userMessage).toContain('404');
  });

  it('names the host, and only the host', () => {
    // A URL can carry a key in its query string; a hostname cannot.
    const error = toRekluError(
      apiCallError({ status: 429, url: 'https://openrouter.ai/api/v1/chat?key=secret-value' }),
    );

    expect(error.userMessage).toContain('openrouter.ai');
    expect(error.userMessage).not.toContain('secret-value');
  });

  it('marks a rate limit worth retrying, and a bad request not', () => {
    expect(toRekluError(apiCallError({ status: 429 })).retryable).toBe(true);
    expect(toRekluError(apiCallError({ status: 503 })).retryable).toBe(true);
    expect(toRekluError(apiCallError({ status: 400 })).retryable).toBe(false);
  });

  it('falls back to the error message when the body is not JSON', () => {
    const error = toRekluError(
      apiCallError({ status: 502, body: '<html>Bad Gateway</html>', message: 'upstream failed' }),
    );
    expect(error.userMessage).toContain('upstream failed');
  });

  it('leaves an ordinary failure as an internal one', () => {
    // Not every error is somebody else's, and claiming otherwise would point
    // the reader away from the logs that do have the answer.
    const error = toRekluError(new Error('a genuine bug'));
    expect(error.code).toBe('INTERNAL');
  });
});
