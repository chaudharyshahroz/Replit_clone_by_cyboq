/**
 * The composer's tools.
 *
 * What matters is that choosing a tool sends it with the message and keeps the
 * conversation where it is — an earlier version navigated away to the Build,
 * Create and Research pages, which emptied the chat every time a tool was
 * used. Choosing nothing must still be an ordinary chat.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/chat',
}));

const { ChatView } = await import('@/components/chat/chat-view');

const models = [
  {
    key: 'gpt-5',
    displayName: 'GPT-5',
    providerName: 'OpenAI',
    description: 'Frontier reasoning',
    speed: 'balanced',
    costTier: 'premium',
    isDevelopmentMock: false,
  },
];

function renderChat() {
  return render(<ChatView models={models} initialMessages={[]} devMockActive={false} />);
}

/** Choose a tool from the composer's + menu. */
async function chooseTool(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: 'Add files or a tool' }));
  const menu = await screen.findByRole('menu', { name: 'Add files or a tool' });
  await user.click(within(menu).getByRole('menuitem', { name: new RegExp(label) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
});

describe('the model selector', () => {
  it('sits in the header, not in the composer', () => {
    const { container } = renderChat();
    const trigger = screen.getByRole('button', { name: /Reklu Auto/ });
    expect(container.querySelector('header')?.contains(trigger)).toBe(true);
    expect(trigger.closest('form')).toBeNull();
  });
});

describe('the + menu', () => {
  it('offers attaching files and the three tools', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole('button', { name: 'Add files or a tool' }));
    const menu = await screen.findByRole('menu', { name: 'Add files or a tool' });

    for (const label of ['Attach files', 'Build', 'Image', 'Research']) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(label) })).toBeDefined();
    }
  });
});

describe('tool selection', () => {
  /** Read the JSON body the composer posted to /api/chat. */
  const sentBody = (): Record<string, unknown> => {
    const call = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;
  };

  it.each([
    ['Build', 'build'],
    ['Research', 'research'],
    ['Image', 'image'],
  ])('sends %s with the message and stays in the chat', async (label, expected) => {
    const user = userEvent.setup();
    renderChat();

    await chooseTool(user, label);
    await user.type(screen.getByRole('textbox', { name: /Ask Reklu anything/ }), 'do the thing');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sentBody()).toMatchObject({ tool: expected, message: 'do the thing' });
    // The whole point: no navigation away from the conversation.
    expect(push).not.toHaveBeenCalled();
  });

  it('sends no tool at all for an ordinary chat', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByRole('textbox', { name: /Ask Reklu anything/ }), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sentBody().tool).toBeUndefined();
    expect(push).not.toHaveBeenCalled();
  });

  it('stops sending a tool once its chip is removed', async () => {
    const user = userEvent.setup();
    renderChat();

    await chooseTool(user, 'Build');
    await user.click(screen.getByRole('button', { name: 'Turn off Build' }));

    await user.type(screen.getByRole('textbox', { name: /Ask Reklu anything/ }), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(sentBody().tool).toBeUndefined();
  });

  it('changes the placeholder to match the tool', async () => {
    const user = userEvent.setup();
    renderChat();

    await chooseTool(user, 'Research');
    expect(screen.getByPlaceholderText('What should Reklu research?')).toBeDefined();
  });
});

describe('suggestions', () => {
  it('offers openers on an empty conversation', () => {
    renderChat();
    expect(screen.getByRole('button', { name: 'Explain what this codebase does' })).toBeDefined();
  });

  it('swaps them for the tool that is selected', async () => {
    const user = userEvent.setup();
    renderChat();

    await chooseTool(user, 'Image');
    expect(screen.queryByRole('button', { name: 'Explain what this codebase does' })).toBeNull();
    expect(
      screen.getByRole('button', { name: /minimal logo for a coffee roastery/ }),
    ).toBeDefined();
  });

  /** They fill the box rather than sending, so a prompt can still be edited. */
  it('puts a chosen suggestion in the composer without sending it', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole('button', { name: 'Explain what this codebase does' }));

    expect(screen.getByRole('textbox', { name: /Ask Reklu anything/ })).toHaveProperty(
      'value',
      'Explain what this codebase does',
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
