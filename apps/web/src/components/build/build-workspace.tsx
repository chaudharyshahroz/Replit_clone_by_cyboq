'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  Code2,
  FileText,
  History,
  Loader2,
  Monitor,
  MousePointerClick,
  Play,
  ShieldAlert,
  Terminal,
} from 'lucide-react';

export interface BuildFile {
  readonly path: string;
  readonly content: string;
  readonly language: string;
}

export interface BuildCheckpoint {
  readonly id: string;
  readonly version: number;
  readonly changeSummary: string | null;
  readonly changedPaths: readonly string[];
  readonly checksPassed: boolean | null;
  readonly createdAt: string;
}

type Panel = 'code' | 'console' | 'preview' | 'history';

/** Build a nested tree from flat paths, for the file explorer (spec §31). */
interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly children: Map<string, TreeNode>;
  readonly isFile: boolean;
}

function buildTree(files: readonly BuildFile[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map(), isFile: false };

  for (const file of files) {
    const segments = file.path.split('/');
    let node = root;

    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      const path = segments.slice(0, index + 1).join('/');
      let child = node.children.get(segment);
      if (!child) {
        child = { name: segment, path, children: new Map(), isFile: isLast };
        node.children.set(segment, child);
      }
      node = child;
    });
  }
  return root;
}

function FileTree({
  node,
  depth,
  selected,
  changed,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selected: string | undefined;
  changed: ReadonlySet<string>;
  onSelect: (path: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const entries = [...node.children.values()].sort((a, b) => {
    if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return (
    <ul className={depth === 0 ? '' : 'ml-3 border-l border-border pl-2'}>
      {entries.map((child) =>
        child.isFile ? (
          <li key={child.path}>
            <button
              type="button"
              onClick={() => onSelect(child.path)}
              aria-current={selected === child.path ? 'true' : undefined}
              className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs transition-colors ${
                selected === child.path
                  ? 'bg-surface-raised text-text'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text'
              }`}
            >
              <FileText className="h-3 w-3 shrink-0" strokeWidth={1.75} />
              <span className="truncate">{child.name}</span>
              {/* Changed-file indicator (spec §31). */}
              {changed.has(child.path) ? (
                <span
                  title="Changed in this version"
                  className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                />
              ) : null}
            </button>
          </li>
        ) : (
          <li key={child.path}>
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(child.path)) next.delete(child.path);
                  else next.add(child.path);
                  return next;
                })
              }
              className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-text-secondary transition-colors hover:text-text"
            >
              <ChevronRight
                className={`h-3 w-3 shrink-0 transition-transform ${
                  collapsed.has(child.path) ? '' : 'rotate-90'
                }`}
                strokeWidth={2}
              />
              <span className="truncate">{child.name}</span>
            </button>
            {!collapsed.has(child.path) ? (
              <FileTree
                node={child}
                depth={depth + 1}
                selected={selected}
                changed={changed}
                onSelect={onSelect}
              />
            ) : null}
          </li>
        ),
      )}
    </ul>
  );
}

/**
 * Whether the browser will refuse to embed this preview.
 *
 * An http page inside an https one is blocked as mixed content, and the block
 * is silent: the iframe stays empty and nothing surfaces anywhere the person
 * looking at it would see.
 */
function blockedAsMixedContent(url: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.protocol === 'https:' && url.startsWith('http://');
}

export function BuildWorkspace({
  buildId,
  files,
  checkpoints,
  consoleOutput,
  previewUrl,
  sandboxIsolated,
  sandboxDetail,
  onStartPreview,
  onEditSelection,
}: {
  buildId: string;
  files: readonly BuildFile[];
  checkpoints: readonly BuildCheckpoint[];
  consoleOutput: string;
  previewUrl: string | null;
  sandboxIsolated: boolean;
  sandboxDetail: string;
  onStartPreview: (buildId: string) => Promise<{ url: string | null; output: string; error?: string }>;
  onEditSelection: (
    buildId: string,
    elementId: string,
    instruction: string,
  ) => Promise<{ error?: string }>;
}) {
  const [panel, setPanel] = useState<Panel>('code');
  const [selectedPath, setSelectedPath] = useState<string | undefined>(files[0]?.path);
  const [livePreview, setLivePreview] = useState<string | null>(previewUrl);
  const [previewError, setPreviewError] = useState<string | undefined>();
  const [previewOutput, setPreviewOutput] = useState('');
  const [starting, setStarting] = useState(false);
  const [selection, setSelection] = useState<string | undefined>();
  const [instruction, setInstruction] = useState('');
  const [editing, startEditing] = useTransition();

  /**
   * Spec §35: the preview posts only the clicked element's id. The origin is
   * not trusted — the id is validated against our own source map server-side
   * before it can influence an edit.
   */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { source?: string; elementId?: string } | null;
      if (data?.source !== 'reklu-preview' || typeof data.elementId !== 'string') return;
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(data.elementId)) return;
      setSelection(data.elementId);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const start = useCallback(async () => {
    setStarting(true);
    setPreviewError(undefined);
    try {
      const result = await onStartPreview(buildId);
      setLivePreview(result.url);
      setPreviewOutput(result.output);
      if (result.error) setPreviewError(result.error);
    } finally {
      setStarting(false);
    }
  }, [buildId, onStartPreview]);

  const tree = useMemo(() => buildTree(files), [files]);
  const changed = useMemo(
    () => new Set(checkpoints[0]?.changedPaths ?? []),
    [checkpoints],
  );
  const selected = files.find((file) => file.path === selectedPath);

  const panels: readonly { id: Panel; label: string; icon: typeof Code2 }[] = [
    { id: 'code', label: 'Code', icon: Code2 },
    { id: 'preview', label: 'Preview', icon: Monitor },
    { id: 'console', label: 'Console', icon: Terminal },
    { id: 'history', label: 'History', icon: History },
  ];

  return (
    <div className="flex h-full flex-col">
      {/*
        Spec §111 and §36: never let a development convenience be mistaken for
        a security boundary.
      */}
      {!sandboxIsolated ? (
        <div className="flex items-start gap-2 border-b border-warning/40 bg-warning/5 px-4 py-2.5">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={2} />
          <p className="text-xs leading-relaxed text-text-secondary">
            <strong className="text-warning">Sandbox is not isolated.</strong> {sandboxDetail}
          </p>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {/* ---- File explorer (spec §31) ---- */}
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface/30 md:flex">
          <h2 className="px-3 py-2.5 text-[0.6875rem] font-medium uppercase tracking-wider text-text-muted">
            Files
          </h2>
          <div className="flex-1 overflow-y-auto px-1.5 pb-3">
            {files.length === 0 ? (
              <p className="px-2 text-xs leading-relaxed text-text-muted">
                No files yet. Describe what you want built and Reklu will generate them.
              </p>
            ) : (
              <FileTree
                node={tree}
                depth={0}
                selected={selectedPath}
                changed={changed}
                onSelect={setSelectedPath}
              />
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <nav className="flex items-center gap-1 border-b border-border px-3 py-1.5" aria-label="Workspace panels">
            {panels.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setPanel(id)}
                aria-current={panel === id ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                  panel === id
                    ? 'bg-surface-raised text-text'
                    : 'text-text-secondary hover:text-text'
                }`}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                {label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-auto">
            {panel === 'code' ? (
              selected ? (
                <div>
                  <p className="border-b border-border px-4 py-2 font-mono text-[0.6875rem] text-text-muted">
                    {selected.path}
                  </p>
                  <pre className="overflow-x-auto p-4">
                    <code className="font-mono text-[0.75rem] leading-relaxed text-text-secondary">
                      {selected.content}
                    </code>
                  </pre>
                </div>
              ) : (
                <p className="p-6 text-sm text-text-muted">Select a file to view it.</p>
              )
            ) : null}

            {panel === 'preview' ? (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                  <button
                    type="button"
                    onClick={() => void start()}
                    disabled={starting || files.length === 0}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:text-text disabled:opacity-40"
                  >
                    {starting ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                    ) : (
                      <Play className="h-3.5 w-3.5" strokeWidth={2} />
                    )}
                    {livePreview ? 'Restart preview' : 'Start preview'}
                  </button>

                  {livePreview ? (
                    <>
                      <a
                        href={livePreview}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded text-xs text-accent hover:text-accent-hover"
                      >
                        Open externally
                      </a>
                      <span className="ml-auto inline-flex items-center gap-1 text-[0.6875rem] text-text-muted">
                        <MousePointerClick className="h-3 w-3" strokeWidth={1.75} />
                        Alt+click an element to edit it
                      </span>
                    </>
                  ) : null}
                </div>

                {previewError ? (
                  <p role="alert" className="border-b border-danger/40 bg-danger/10 px-4 py-2 text-xs text-text">
                    {previewError}
                    {previewOutput ? ' See the Console panel for the full output.' : ''}
                  </p>
                ) : null}

                {selection ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const text = instruction.trim();
                      if (!text) return;
                      startEditing(async () => {
                        await onEditSelection(buildId, selection, text);
                        setInstruction('');
                        setSelection(undefined);
                      });
                    }}
                    className="flex items-center gap-2 border-b border-accent-border bg-accent-subtle px-4 py-2"
                  >
                    <MousePointerClick className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2} />
                    <label htmlFor="selection-instruction" className="sr-only">
                      Change the selected element
                    </label>
                    <input
                      id="selection-instruction"
                      value={instruction}
                      onChange={(event) => setInstruction(event.target.value)}
                      placeholder="Make this smaller and change the spacing…"
                      className="min-w-0 flex-1 bg-transparent text-xs text-text placeholder:text-text-muted focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={editing || !instruction.trim()}
                      className="shrink-0 rounded-md bg-accent px-2 py-1 text-[0.6875rem] font-medium text-on-accent disabled:opacity-40"
                    >
                      {editing ? 'Applying…' : 'Apply'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelection(undefined)}
                      className="shrink-0 rounded text-[0.6875rem] text-text-muted hover:text-text"
                    >
                      Cancel
                    </button>
                  </form>
                ) : null}

                {livePreview && blockedAsMixedContent(livePreview) ? (
                  /*
                   * Said, rather than shown as an empty panel. A plain-http
                   * preview inside this https page is blocked by the browser
                   * before the iframe loads anything — no error, no console
                   * message the user will look at, just a blank rectangle that
                   * reads as a build that failed.
                   */
                  <div className="p-6">
                    <p className="text-sm text-text">
                      This preview cannot be shown inside Reklu
                    </p>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
                      Your browser refuses to embed an insecure page inside a secure
                      one. The application is running — it just cannot be framed here.
                    </p>
                    <a
                      href={livePreview}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                    >
                      Open the preview in a new tab
                    </a>
                    <p className="mt-4 max-w-md text-xs leading-relaxed text-text-muted">
                      To embed it here, serve the sandbox host over https and set
                      SANDBOX_PREVIEW_HOST to that https address.
                    </p>
                  </div>
                ) : livePreview ? (
                  <iframe
                    src={livePreview}
                    title="Application preview"
                    // Served from a separate origin and sandboxed: generated
                    // code must never reach Reklu's session cookie.
                    sandbox="allow-scripts allow-forms"
                    className="min-h-[480px] flex-1 border-0 bg-white"
                  />
                ) : (
                  <div className="p-6">
                    <p className="text-sm text-text">Preview is not running</p>
                    <p className="mt-2 max-w-md text-sm leading-relaxed text-text-secondary">
                      {files.length === 0
                        ? 'Generate an application first, then Reklu will install its dependencies and start a dev server here.'
                        : 'Start the preview and Reklu will install dependencies and run the dev server.'}
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {panel === 'console' ? (
              (previewOutput || consoleOutput).trim().length > 0 ? (
                <pre className="overflow-x-auto p-4">
                  <code className="font-mono text-[0.75rem] leading-relaxed text-text-secondary">
                    {previewOutput || consoleOutput}
                  </code>
                </pre>
              ) : (
                <p className="p-6 text-sm text-text-muted">
                  No output yet. Install and build output appears here — including failures.
                </p>
              )
            ) : null}

            {panel === 'history' ? (
              checkpoints.length === 0 ? (
                <p className="p-6 text-sm text-text-muted">
                  No checkpoints yet. Every change Reklu makes creates one, so nothing is lost.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {checkpoints.map((checkpoint) => (
                    <li key={checkpoint.id} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-text-muted">
                          v{checkpoint.version}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-text">
                          {checkpoint.changeSummary ?? 'Updated'}
                        </span>
                        {checkpoint.checksPassed === false ? (
                          <span
                            title="Checks failed for this version"
                            className="inline-flex items-center gap-1 text-[0.6875rem] text-warning"
                          >
                            <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                            checks failed
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-[0.6875rem] text-text-muted">
                        {checkpoint.changedPaths.length} file
                        {checkpoint.changedPaths.length === 1 ? '' : 's'} changed ·{' '}
                        {new Date(checkpoint.createdAt).toLocaleString()}
                      </p>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
