/**
 * The sidebar is the only navigation in the product, and its per-chat menu
 * performs destructive work, so its behaviour is worth pinning down.
 *
 * Server actions and next/navigation are stubbed: what is under test is the
 * component's own logic — which action fires for which click, when the rename
 * input commits, and whether deleting the chat you are reading navigates away
 * while deleting a different one leaves you alone.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConversationSummary } from '@/lib/conversations';

const push = vi.fn();
const refresh = vi.fn();
let pathname = '/chat';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => pathname,
}));

const renameThreadAction = vi.fn(async () => ({}));
const pinThreadAction = vi.fn(async () => ({}));
const moveThreadToProjectAction = vi.fn(async () => ({}));
const deleteThreadAction = vi.fn(async () => ({}));

vi.mock('@/app/(app)/chat/actions', () => ({
  renameThreadAction: (...args: unknown[]) => renameThreadAction(...(args as [])),
  pinThreadAction: (...args: unknown[]) => pinThreadAction(...(args as [])),
  moveThreadToProjectAction: (...args: unknown[]) =>
    moveThreadToProjectAction(...(args as [])),
  deleteThreadAction: (...args: unknown[]) => deleteThreadAction(...(args as [])),
}));

vi.mock('@/app/(auth)/actions', () => ({ signOutAction: vi.fn() }));

// The dialog pulls in a server action module; the sidebar only needs it to mount.
vi.mock('@/components/projects/new-project', () => ({
  NewProjectDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">New project</div> : null,
}));

const { Sidebar } = await import('@/components/app/sidebar');

const thread = (overrides: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: 'cnv_1',
  title: 'Quarterly plan',
  lastMessageAt: new Date(),
  messageCount: 4,
  mode: 'chat',
  pinned: false,
  projectId: null,
  ...overrides,
});

function renderSidebar(threads: ConversationSummary[] = [thread()]) {
  return render(
    <Sidebar
      workspaceName="Acme"
      userName="Shahroz"
      userEmail="shahroz@example.com"
      threads={threads}
      projects={[{ id: 'prj_1', name: 'Launch' }]}
    />,
  );
}

/** Open a chat's overflow menu and return the menu element. */
async function openThreadMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Actions for Quarterly plan/ }));
  return screen.getByRole('menu');
}

beforeEach(() => {
  pathname = '/chat';
  vi.clearAllMocks();
});

describe('navigation', () => {
  it('offers the four destinations', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: 'New chat' })).toHaveProperty('href');
    expect(screen.getByRole('link', { name: 'Projects' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Agents' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'More' })).toBeDefined();
  });

  it('hides the secondary surfaces behind More until it is opened', async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.queryByRole('menuitem', { name: /Skills/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More' }));
    const menu = screen.getByRole('menu', { name: 'More' });
    for (const label of ['Skills', 'Connectors', 'Artifacts', 'Compare AI']) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(label) })).toBeDefined();
    }
  });

  it('closes a menu on Escape', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu', { name: 'More' })).toBeDefined();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'More' })).toBeNull());
  });

  it('shows the signed-in account', () => {
    renderSidebar();
    expect(screen.getByText('Shahroz')).toBeDefined();
    expect(screen.getByText('shahroz@example.com')).toBeDefined();
  });

  it('puts Settings, Upgrade, Help and Log out behind the account button', async () => {
    const user = userEvent.setup();
    renderSidebar();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    const menu = screen.getByRole('menu', { name: 'Account' });
    for (const label of ['Settings', 'Upgrade', 'Help', 'Log out']) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(label) })).toBeDefined();
    }
  });
});

describe('history', () => {
  it('says what will appear rather than showing an empty panel', () => {
    renderSidebar([]);
    expect(screen.getByText(/Your chats appear here/)).toBeDefined();
  });

  it('lists chats with a link to each', () => {
    renderSidebar();
    const link = screen.getByRole('link', { name: /Quarterly plan/ });
    expect(link.getAttribute('href')).toBe('/chat/cnv_1');
  });
});

describe('the per-chat menu', () => {
  it('pins an unpinned chat', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Pin' }));

    await waitFor(() => expect(pinThreadAction).toHaveBeenCalledWith('cnv_1', true));
  });

  it('offers Unpin for a chat that is already pinned', async () => {
    const user = userEvent.setup();
    renderSidebar([thread({ pinned: true })]);

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Unpin' }));

    await waitFor(() => expect(pinThreadAction).toHaveBeenCalledWith('cnv_1', false));
  });

  it('renames through an inline field, committed with Enter', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }));

    const field = screen.getByRole('textbox', { name: 'Chat name' });
    await user.clear(field);
    await user.type(field, 'Q3 plan{Enter}');

    await waitFor(() => expect(renameThreadAction).toHaveBeenCalledWith('cnv_1', 'Q3 plan'));
  });

  it('abandons a rename on Escape without calling the action', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Rename' }));

    const field = screen.getByRole('textbox', { name: 'Chat name' });
    await user.clear(field);
    await user.type(field, 'discarded{Escape}');

    expect(renameThreadAction).not.toHaveBeenCalled();
  });

  it('files a chat into a chosen project', async () => {
    const user = userEvent.setup();
    renderSidebar();

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Add to project/ }));
    await user.click(screen.getByRole('menuitem', { name: /Launch/ }));

    await waitFor(() =>
      expect(moveThreadToProjectAction).toHaveBeenCalledWith('cnv_1', 'prj_1'),
    );
  });

  it('only offers removal when the chat is in a project', async () => {
    const user = userEvent.setup();
    renderSidebar([thread({ projectId: 'prj_1' })]);

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Add to project/ }));

    expect(screen.getByRole('menuitem', { name: 'Remove from project' })).toBeDefined();
  });

  /**
   * The two halves of the delete contract. Deleting the open chat has to move
   * you off a URL that is about to 404; deleting any other chat must not.
   */
  it('navigates away when deleting the chat being read', async () => {
    pathname = '/chat/cnv_1';
    const user = userEvent.setup();
    renderSidebar();

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => expect(deleteThreadAction).toHaveBeenCalledWith('cnv_1'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/chat'));
  });

  it('stays put when deleting a chat that is not open', async () => {
    pathname = '/chat/cnv_other';
    const user = userEvent.setup();
    renderSidebar();

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => expect(deleteThreadAction).toHaveBeenCalledWith('cnv_1'));
    expect(push).not.toHaveBeenCalled();
  });

  it('surfaces an action failure instead of silently doing nothing', async () => {
    deleteThreadAction.mockResolvedValueOnce({ error: 'Could not delete the chat.' });
    const user = userEvent.setup();
    renderSidebar();

    const menu = await openThreadMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    expect(await screen.findByRole('alert')).toBeDefined();
  });
});
