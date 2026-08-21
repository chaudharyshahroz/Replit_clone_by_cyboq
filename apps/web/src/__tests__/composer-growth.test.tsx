/**
 * The composer grows with what is typed, and stops.
 *
 * A fixed box wastes height when empty and cramps a long prompt. Growing
 * without a ceiling is worse: the composer eats the conversation it belongs to.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { composerSize, MAX_COMPOSER_LINES } from '@/lib/composer-size';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/chat',
}));

const { ChatView } = await import('@/components/chat/chat-view');

const models = [
  {
    key: 'gpt-5',
    displayName: 'GPT-5',
    providerName: 'OpenAI',
    description: null,
    speed: 'balanced',
    costTier: 'premium',
    isDevelopmentMock: false,
  },
];

/**
 * jsdom reports every scrollHeight as 0, so growth cannot be observed there.
 * What can be checked is the contract the effect depends on: the field starts
 * at one row, and the effect sets an explicit height and an overflow rule
 * rather than leaving the element to the browser's default sizing.
 */
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});

describe('the composer', () => {
  it('starts at a single row rather than a fixed block', () => {
    render(<ChatView models={models} initialMessages={[]} devMockActive={false} />);
    const field = screen.getByRole('textbox', { name: /Ask Reklu anything/ });

    expect(field.getAttribute('rows')).toBe('1');
  });

  it('takes control of its own height', async () => {
    const user = userEvent.setup();
    render(<ChatView models={models} initialMessages={[]} devMockActive={false} />);
    const field = screen.getByRole('textbox', { name: /Ask Reklu anything/ });

    await user.type(field, 'a long prompt that would wrap onto another line');

    // Set by the resize effect; absent if it never ran.
    expect((field as HTMLTextAreaElement).style.height).not.toBe('');
    expect((field as HTMLTextAreaElement).style.overflowY).not.toBe('');
  });

});

/**
 * The ceiling itself, given numbers directly.
 *
 * Driving the real textarea cannot test this: jsdom reports every scrollHeight
 * as 0, so a test that types into the field passes identically whether the cap
 * exists or not — which is exactly what happened before this was split out.
 */
describe('the growth ceiling', () => {
  const metrics = { lineHeight: 20, paddingTop: 14, paddingBottom: 14 };
  const ceiling = 20 * MAX_COMPOSER_LINES + 28;

  it('fits itself to a short prompt', () => {
    expect(composerSize({ ...metrics, scrollHeight: 48 })).toEqual({
      height: 48,
      overflowY: 'hidden',
    });
  });

  it('stops at the ceiling and scrolls instead of growing', () => {
    expect(composerSize({ ...metrics, scrollHeight: 400 })).toEqual({
      height: ceiling,
      overflowY: 'auto',
    });
  });

  it('does not scroll at exactly the ceiling', () => {
    expect(composerSize({ ...metrics, scrollHeight: ceiling })).toEqual({
      height: ceiling,
      overflowY: 'hidden',
    });
  });

  /** The ceiling is measured, so a larger type scale gets proportionally more room. */
  it('scales the ceiling with the line height', () => {
    const larger = composerSize({ ...metrics, lineHeight: 30, scrollHeight: 400 });
    expect(larger.height).toBe(30 * MAX_COMPOSER_LINES + 28);
  });
});
