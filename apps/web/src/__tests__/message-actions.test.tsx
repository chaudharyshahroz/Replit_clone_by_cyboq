/**
 * The controls under a reply.
 *
 * Every one of them has to do something. A thumb that records nothing, or a
 * share button that copies a link only its owner can open, is a control
 * pretending to work — which is worse than not offering it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const rateMessageAction = vi.fn(async () => ({}));
vi.mock('@/app/(app)/chat/actions', () => ({
  rateMessageAction: (...args: unknown[]) => rateMessageAction(...(args as [])),
}));

const { MessageActions } = await import('@/components/chat/message-actions');

const writeText = vi.fn(async () => {});

/**
 * `navigator.clipboard` is a getter, and userEvent.setup() installs its own
 * stub over it. Defining the property outright — after setup, inside each test
 * that needs it — is the only assignment that survives both.
 */
function stubClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubClipboard();
});

describe('copy', () => {
  it('copies the message text', async () => {
    const user = userEvent.setup();
    stubClipboard();
    render(<MessageActions text="the answer" />);

    await user.click(screen.getByRole('button', { name: 'Copy reply' }));
    expect(writeText).toHaveBeenCalledWith('the answer');
  });

  it('says so when the browser blocks the clipboard', async () => {
    const user = userEvent.setup();
    stubClipboard();
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<MessageActions text="the answer" />);

    await user.click(screen.getByRole('button', { name: 'Copy reply' }));
    expect(await screen.findByRole('alert')).toBeDefined();
  });
});

describe('rating', () => {
  it('records a thumbs up against the message', async () => {
    const user = userEvent.setup();
    render(<MessageActions text="x" messageId="msg_1" />);

    await user.click(screen.getByRole('button', { name: 'Good response' }));
    await waitFor(() => expect(rateMessageAction).toHaveBeenCalledWith('msg_1', 'up'));
  });

  /** An opinion can be withdrawn by pressing the same thumb again. */
  it('clears a rating when the same thumb is pressed twice', async () => {
    const user = userEvent.setup();
    render(<MessageActions text="x" messageId="msg_1" initialFeedback="up" />);

    await user.click(screen.getByRole('button', { name: 'Good response' }));
    await waitFor(() => expect(rateMessageAction).toHaveBeenCalledWith('msg_1', null));
  });

  it('shows which rating is currently set', () => {
    render(<MessageActions text="x" messageId="msg_1" initialFeedback="down" />);
    expect(
      screen.getByRole('button', { name: 'Bad response' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  /**
   * A turn that was never persisted has no id to rate against, so the thumbs
   * are absent rather than present and inert.
   */
  it('offers no rating for a message that has no id', () => {
    render(<MessageActions text="x" />);
    expect(screen.queryByRole('button', { name: 'Good response' })).toBeNull();
  });

  it('puts the rating back if the server refuses it', async () => {
    rateMessageAction.mockResolvedValueOnce({ error: 'Could not record that.' });
    const user = userEvent.setup();
    render(<MessageActions text="x" messageId="msg_1" />);

    await user.click(screen.getByRole('button', { name: 'Good response' }));

    expect(await screen.findByRole('alert')).toBeDefined();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Good response' }).getAttribute('aria-pressed'),
      ).toBe('false'),
    );
  });
});

describe('regenerate', () => {
  it('is offered only when the caller supplies a handler', () => {
    const { rerender } = render(<MessageActions text="x" messageId="msg_1" />);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();

    rerender(<MessageActions text="x" messageId="msg_1" onRegenerate={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('calls back when pressed', async () => {
    const onRegenerate = vi.fn();
    const user = userEvent.setup();
    render(<MessageActions text="x" messageId="msg_1" onRegenerate={onRegenerate} />);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
