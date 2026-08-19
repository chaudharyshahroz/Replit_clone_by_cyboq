/**
 * The composer's tool routing.
 *
 * What matters here is that choosing a tool sends the request to the surface
 * that implements it — carrying the prompt — and that choosing nothing still
 * produces an ordinary streamed chat. Getting that backwards would either
 * strand people on a blank Build page or silently answer a build request with
 * prose.
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

describe('tool routing', () => {
  it.each([
    ['Build', '/build', 'a booking page for a barber shop'],
    ['Research', '/research', 'compare two note-taking apps'],
  ])('sends a %s request to %s with the prompt', async (label, path, prompt) => {
    const user = userEvent.setup();
    renderChat();

    await chooseTool(user, label);
    await user.type(screen.getByRole('textbox', { name: /Ask Reklu anything/ }), prompt);
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const target = push.mock.calls[0]![0] as string;
    expect(target.startsWith(`${path}?`)).toBe(true);
    expect(new URL(target, 'http://x').searchParams.get('q')).toBe(prompt);
  });

  it('asks Create for an image, not a document', async () => {
    const user = userEvent.setup();
    renderChat();

    await chooseTool(user, 'Image');
    await user.type(screen.getByRole('textbox', { name: /Ask Reklu anything/ }), 'a red bicycle');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const url = new URL(push.mock.calls[0]![0] as string, 'http://x');
    expect(url.pathname).toBe('/create');
    expect(url.searchParams.get('kind')).toBe('image');
    expect(url.searchParams.get('q')).toBe('a red bicycle');
  });

  /** The default has to stay plain chat, or every message becomes a handoff. */
  it('streams an ordinary chat when no tool is chosen', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByRole('textbox', { name: /Ask Reklu anything/ }), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it('turns a tool back off from its chip, restoring plain chat', async () => {
    const user = userEvent.setup();
    renderChat();

    await chooseTool(user, 'Build');
    await user.click(screen.getByRole('button', { name: 'Turn off Build' }));

    await user.type(screen.getByRole('textbox', { name: /Ask Reklu anything/ }), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it('changes the placeholder to match the tool', async () => {
    const user = userEvent.setup();
    renderChat();

    await chooseTool(user, 'Research');
    expect(
      screen.getByPlaceholderText('What should Reklu research?'),
    ).toBeDefined();
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
