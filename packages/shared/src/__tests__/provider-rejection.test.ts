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

  it('recognises the provider wrapper used by the AI adapters', () => {
    const wrapped = Object.assign(new Error('rate limited'), {
      name: 'ProviderCallError',
      providerKey: 'openrouter',
      statusCode: 429,
      retryable: true,
    });

    const error = toRekluError(wrapped);
    expect(error.code).toBe('PROVIDER_ERROR');
    expect(error.userMessage).toContain('openrouter');
    expect(error.retryable).toBe(true);
  });

  it('preserves the upstream provider explanation through its wrapper', () => {
    const cause = apiCallError({
      status: 402,
      body: JSON.stringify({ error: { message: 'Insufficient credits.' } }),
    });
    const wrapped = Object.assign(new Error('wrapped call failed'), {
      name: 'ProviderCallError',
      providerKey: 'openrouter',
      statusCode: 402,
      retryable: false,
      cause,
    });

    expect(toRekluError(wrapped).userMessage).toContain('Insufficient credits');
  });

  it('leaves an ordinary failure as an internal one', () => {
    // Not every error is somebody else's, and claiming otherwise would point
    // the reader away from the logs that do have the answer.
    const error = toRekluError(new Error('a genuine bug'));
    expect(error.code).toBe('INTERNAL');
  });
});

describe('the adapter’s verdict on retrying', () => {
  /**
   * The adapter reads the provider's prose; this function only sees the status
   * code. Rebuilding the answer from the status alone discarded the better
   * judgement, and with it every fallback the adapter existed to enable.
   *
   * The vision fallback is the proof. `isRetryableProviderFailure` marks a 404
   * saying "no endpoints found that support image input" retryable, and has a
   * test saying so — but by the time a caller read the normalized error it was
   * non-retryable again, so the fallback could never fire.
   */
  function wrapped(cause: Error, retryable: boolean): Error {
    return Object.assign(new Error(cause.message), {
      name: 'ProviderCallError',
      providerKey: 'openrouter',
      statusCode: (cause as Error & { statusCode?: number }).statusCode,
      retryable,
      cause,
    });
  }

  it('keeps a retryable verdict the adapter already reached', () => {
    const retired = apiCallError({
      status: 404,
      message:
        'This model is unavailable for free. The paid version is available now - use this slug instead: minimax/minimax-m2.7',
    });

    expect(toRekluError(wrapped(retired, true)).retryable).toBe(true);
  });

  it('keeps the vision mismatch retryable, which is why that branch exists', () => {
    const vision = apiCallError({
      status: 404,
      message: 'No endpoints found that support image input',
    });

    expect(toRekluError(wrapped(vision, true)).retryable).toBe(true);
  });

  it('still shows the provider’s own sentence, not a generic one', () => {
    const retired = apiCallError({
      status: 404,
      message: 'This model is unavailable for free.',
    });

    const normalized = toRekluError(wrapped(retired, true));
    expect(normalized.userMessage).toContain('unavailable for free');
    expect(normalized.userMessage).toContain('openrouter.ai');
  });

  it('does not invent a retry the adapter did not ask for', () => {
    /*
     * A plainly wrong model name stays non-retryable: it is a mistake to
     * surface, not one to paper over by spending budget on three more models.
     */
    const missing = apiCallError({ status: 404, message: 'Model not found' });

    expect(toRekluError(wrapped(missing, false)).retryable).toBe(false);
    // And an unwrapped rejection is still judged by its status alone.
    expect(toRekluError(missing).retryable).toBe(false);
    expect(toRekluError(apiCallError({ status: 429, message: 'Rate limited' })).retryable).toBe(
      true,
    );
  });
});

describe('a provider failure with no HTTP response', () => {
  /**
   * A timeout, a cancelled request and a stream that died halfway all produced
   * the same sentence: "could not generate this build. Try Reklu Auto again or
   * choose another model." The adapter had already written a specific, safe
   * description of each, and it was discarded — so a reader could not tell
   * whether waiting, retrying, or changing model was the thing to do.
   */
  function callError(message: string, retryable = false): Error {
    return Object.assign(new Error(message), {
      name: 'ProviderCallError',
      providerKey: 'openrouter',
      retryable,
      message,
    });
  }

  it('says the provider timed out, rather than only that it failed', () => {
    const normalized = toRekluError(
      callError('The provider did not respond before the request deadline.', true),
    );

    expect(normalized.userMessage).toContain('did not respond before the request deadline');
    expect(normalized.userMessage).toContain('openrouter');
  });

  it('keeps the advice, which is still worth giving', () => {
    expect(toRekluError(callError('Upstream connection reset.')).userMessage).toContain(
      'Reklu Auto',
    );
  });

  it('does not pad the message when there is nothing to add', () => {
    const normalized = toRekluError(callError('No detail given'));

    expect(normalized.userMessage).not.toContain('No detail given');
    expect(normalized.userMessage).toContain('could not generate this build');
  });

  it('caps a long provider message rather than pasting an essay', () => {
    const normalized = toRekluError(callError('x'.repeat(1_000)));

    expect(normalized.userMessage.length).toBeLessThan(450);
  });
});
