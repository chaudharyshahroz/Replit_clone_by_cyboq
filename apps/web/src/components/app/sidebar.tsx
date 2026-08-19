'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  Bot,
  Boxes,
  Columns2,
  HelpCircle,
  Layers,
  LogOut,
  MessageSquarePlus,
  MoreHorizontal,
  Pin,
  PinOff,
  Plug,
  Plus,
  Settings,
  Sparkles,
  SquarePen,
  Trash2,
  Wrench,
} from 'lucide-react';
import { Menu, MenuItem, MenuLink, MenuSeparator } from '@/components/ui/menu';
import { NewProjectDialog } from '@/components/projects/new-project';
import { Wordmark } from '@/components/brand/logo';
import { signOutAction } from '@/app/(auth)/actions';
import {
  deleteThreadAction,
  moveThreadToProjectAction,
  pinThreadAction,
  renameThreadAction,
} from '@/app/(app)/chat/actions';
import type { ConversationSummary } from '@/lib/conversations';

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
}

/**
 * The workspace sidebar.
 *
 * Four destinations, then history — the shape people already know from every
 * other assistant, so nothing here needs learning. Everything past the four is
 * the user's own material.
 *
 * "More" holds the surfaces you configure once and rarely revisit (Skills,
 * Connectors, Artifacts, Compare). Keeping them out of the top level is what
 * lets history start near the top of the panel, which is where it is used.
 */

const ROW =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors';

function navClass(active: boolean): string {
  return `${ROW} ${
    active
      ? 'bg-surface-raised font-medium text-text'
      : 'text-text-secondary hover:bg-surface-hover hover:text-text'
  }`;
}

/** Relative time that stays readable without pulling in a date library. */
function timeAgo(date: Date | null): string {
  if (!date) return '';
  const seconds = Math.max(0, (Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/* ---- One conversation in the history list ------------------------------- */

function ThreadRow({
  thread,
  projects,
  active,
}: {
  thread: ConversationSummary;
  projects: readonly ProjectOption[];
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const [error, setError] = useState<string | undefined>();

  const apply = (work: () => Promise<{ error?: string }>): void => {
    startTransition(async () => {
      const result = await work();
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(undefined);
      router.refresh();
    });
  };

  const commitRename = (): void => {
    setRenaming(false);
    if (draft.trim() === thread.title) return;
    apply(() => renameThreadAction(thread.id, draft));
  };

  if (renaming) {
    return (
      <li>
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitRename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitRename();
            }
            if (event.key === 'Escape') {
              setDraft(thread.title);
              setRenaming(false);
            }
          }}
          aria-label="Chat name"
          maxLength={200}
          className="w-full rounded-lg border border-accent bg-surface px-2.5 py-2 text-sm text-text outline-none"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <Link
        href={`/chat/${thread.id}`}
        aria-current={active ? 'page' : undefined}
        className={`${navClass(active)} pr-8 ${pending ? 'opacity-50' : ''}`}
      >
        {thread.pinned ? (
          <Pin className="h-3 w-3 shrink-0 text-text-muted" strokeWidth={2} aria-label="Pinned" />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        <span className="shrink-0 text-[11px] text-text-muted group-hover:invisible">
          {timeAgo(thread.lastMessageAt)}
        </span>
      </Link>

      {/*
        Revealed on hover, but never hidden from the keyboard: focus-within
        keeps it reachable by Tab, which display:none would not.
      */}
      <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <ThreadMenu
          thread={thread}
          projects={projects}
          onRename={() => {
            setDraft(thread.title);
            setRenaming(true);
          }}
          onAction={apply}
        />
      </div>

      {error ? (
        <p role="alert" className="px-2.5 pb-1 text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function ThreadMenu({
  thread,
  projects,
  onRename,
  onAction,
}: {
  thread: ConversationSummary;
  projects: readonly ProjectOption[];
  onRename: () => void;
  onAction: (work: () => Promise<{ error?: string }>) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [picking, setPicking] = useState(false);

  return (
    <Menu
      label={`Actions for ${thread.title}`}
      align="right"
      trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={2} />}
      triggerClassName="flex h-6 w-6 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
    >
      {(close) =>
        picking ? (
          <>
            <MenuSeparator label="Add to project" />
            {projects.length === 0 ? (
              <p className="px-2.5 py-2 text-xs leading-relaxed text-text-muted">
                No projects yet. Create one to file chats into it.
              </p>
            ) : (
              projects.map((project) => (
                <MenuItem
                  key={project.id}
                  onSelect={() => {
                    onAction(() => moveThreadToProjectAction(thread.id, project.id));
                    setPicking(false);
                    close();
                  }}
                >
                  <Layers className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  <span className="truncate">{project.name}</span>
                </MenuItem>
              ))
            )}
            {thread.projectId ? (
              <>
                <MenuSeparator />
                <MenuItem
                  onSelect={() => {
                    onAction(() => moveThreadToProjectAction(thread.id, null));
                    setPicking(false);
                    close();
                  }}
                >
                  Remove from project
                </MenuItem>
              </>
            ) : null}
          </>
        ) : (
          <>
            <MenuItem
              onSelect={() => {
                onRename();
                close();
              }}
            >
              <SquarePen className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              Rename
            </MenuItem>

            <MenuItem
              onSelect={() => {
                onAction(() => pinThreadAction(thread.id, !thread.pinned));
                close();
              }}
            >
              {thread.pinned ? (
                <PinOff className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              ) : (
                <Pin className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              )}
              {thread.pinned ? 'Unpin' : 'Pin'}
            </MenuItem>

            {/* Stays open: the next step is choosing which project. */}
            <MenuItem onSelect={() => setPicking(true)}>
              <Layers className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              Add to project
            </MenuItem>

            <MenuSeparator />

            <MenuItem
              tone="danger"
              onSelect={() => {
                close();
                onAction(async () => {
                  const result = await deleteThreadAction(thread.id);
                  /*
                   * Only leave the page if the thread just deleted is the one
                   * being read; tidying up a different chat should not move
                   * anybody.
                   */
                  if (!result.error && pathname === `/chat/${thread.id}`) {
                    router.push('/chat');
                  }
                  return result;
                });
              }}
            >
              <Trash2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              Delete
            </MenuItem>
          </>
        )
      }
    </Menu>
  );
}

/* ---- The sidebar -------------------------------------------------------- */

export function Sidebar({
  workspaceName,
  userName,
  userEmail,
  threads,
  projects,
}: {
  workspaceName: string;
  userName: string;
  userEmail: string;
  threads: readonly ConversationSummary[];
  projects: readonly ProjectOption[];
}) {
  const pathname = usePathname();
  /*
   * The create-project dialog is owned here rather than by the layout: the
   * layout is a server component and cannot hand a client component a
   * callback to open it.
   */
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const isActive = (href: string): boolean =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-border bg-surface/40">
      <div className="px-4 py-4">
        <Link href="/chat" className="inline-block rounded-md" aria-label="Reklu">
          <Wordmark />
        </Link>
      </div>

      <nav aria-label="Workspace" className="px-3">
        <ul className="space-y-0.5">
          <li>
            <Link href="/chat" className={navClass(pathname === '/chat')}>
              <MessageSquarePlus className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              New chat
            </Link>
          </li>

          <li className="flex items-center gap-1">
            <Link href="/projects" className={`${navClass(isActive('/projects'))} flex-1`}>
              <Layers className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              Projects
            </Link>
            <button
              type="button"
              onClick={() => setNewProjectOpen(true)}
              aria-label="New project"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
            </button>
          </li>

          <li>
            <Link href="/agents" className={navClass(isActive('/agents'))}>
              <Bot className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              Agents
            </Link>
          </li>

          <li>
            <Menu
              label="More"
              panelClassName="w-56"
              triggerClassName={`${navClass(
                isActive('/skills') ||
                  isActive('/artifacts') ||
                  isActive('/compare') ||
                  isActive('/settings/connections'),
              )} w-full`}
              trigger={
                <>
                  <MoreHorizontal className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  More
                </>
              }
            >
              {(close) => (
                <>
                  <MenuLink href="/skills" onSelect={close}>
                    <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      Skills
                  </MenuLink>
                  <MenuLink href="/settings/connections" onSelect={close}>
                    <Plug className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      Connectors
                  </MenuLink>
                  <MenuLink href="/artifacts" onSelect={close}>
                    <Boxes className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      Artifacts
                  </MenuLink>
                  <MenuLink href="/compare" onSelect={close}>
                    <Columns2 className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      Compare AI
                  </MenuLink>
                  <MenuSeparator />
                  <MenuLink href="/research" onSelect={close}>
                    <Wrench className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                      Research &amp; Build
                  </MenuLink>
                </>
              )}
            </Menu>
          </li>
        </ul>
      </nav>

      {/* ---- History ---- */}
      <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <h2 className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-muted">
          Chats
        </h2>

        {threads.length === 0 ? (
          // Spec §90 — say what will appear here rather than showing nothing.
          <p className="px-2.5 py-2 text-xs leading-relaxed text-text-muted">
            Your chats appear here once you send a message.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {threads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                projects={projects}
                active={pathname === `/chat/${thread.id}`}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ---- Account ---- */}
      <div className="border-t border-border p-3">
        <Menu
          label="Account"
          side="top"
          panelClassName="w-[13.5rem]"
          triggerClassName={`${ROW} w-full text-left text-text-secondary hover:bg-surface-hover`}
          trigger={
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-text">{userName}</span>
              <span className="block truncate text-xs text-text-muted">{userEmail}</span>
            </span>
          }
        >
          {(close) => (
            <>
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] uppercase tracking-wider text-text-muted">
                {workspaceName}
              </p>
              <MenuSeparator />
              <MenuLink href="/settings" onSelect={close}>
                    <Settings className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Settings
                  </MenuLink>
              <MenuLink href="/settings/billing" onSelect={close}>
                    <Sparkles className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Upgrade
                  </MenuLink>
              <MenuLink href="/help" onSelect={close}>
                    <HelpCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Help
                  </MenuLink>
              <MenuSeparator />
              {/*
                A real form post, not a link: signing out changes state, and a
                GET that mutates is one prefetch away from logging people out
                on its own.
              */}
              <form action={signOutAction}>
                <button
                  type="submit"
                  role="menuitem"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text"
                >
                  <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  Log out
                </button>
              </form>
            </>
          )}
        </Menu>
      </div>
      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </aside>
  );
}
