'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { previewLogsAction } from '@/app/(app)/build/actions';
import { fetchBuildProgress } from '@/lib/build-progress';
import { compileErrorIn } from '@/lib/compile-error';
import { generateBuildAction } from '@/app/(app)/build/actions';
import { ExportPanel } from './export-panel';
import { fileLook, languageFor } from '@/lib/file-icon';
import { siteRoutes } from '@/lib/site-routes';
import { Menu, MenuItem } from '@/components/ui/menu';
import { TOKEN_CLASS, tokenize } from '@/lib/highlight';
import {
  AlertTriangle,
  ChevronRight,
  Code2,
  FileText,
  History,
  Loader2,
  Tablet,
  Smartphone,
  RotateCw,
  ExternalLink,
  ChevronDown,
  Check,
  Monitor,
  Rocket,
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

type Panel = 'code' | 'console' | 'preview' | 'history' | 'deploy';

type DeviceName = 'desktop' | 'tablet' | 'mobile';

/**
 * The widths to check a layout at.
 *
 * Real device widths rather than round numbers: 390 is an iPhone and 820 an
 * iPad, and a layout that holds at 400 but breaks at 390 is broken.
 */
const DEVICES: readonly { id: DeviceName; label: string; width: number | null; icon: typeof Monitor }[] = [
  { id: 'desktop', label: 'Desktop', width: null, icon: Monitor },
  { id: 'tablet', label: 'Tablet', width: 820, icon: Tablet },
  { id: 'mobile', label: 'Mobile', width: 390, icon: Smartphone },
];

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
              {(() => {
                /* Shape and colour by kind, so the eye can find a stylesheet
                   or a config without reading forty identical rows. */
                const look = fileLook(child.path);
                return (
                  <look.icon
                    className={`h-3.5 w-3.5 shrink-0 ${look.className}`}
                    strokeWidth={1.75}
                  />
                );
              })()}
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
  framingProblem,
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
  /**
   * Why the browser will refuse to frame the preview, when it will.
   *
   * The refusal itself says only "this content is blocked", which names neither
   * the policy nor the page that set it — so without this the evidence points
   * at the preview, which is working.
   */
  framingProblem?: string | null;
  onStartPreview: (buildId: string) => Promise<{ url: string | null; output: string; error?: string }>;
  onEditSelection: (
    buildId: string,
    elementId: string,
    instruction: string,
  ) => Promise<{ error?: string }>;
}) {
  /*
   * The preview is the point once there is something to preview. Landing on the
   * code listing made the first thing anyone saw after a build a file tree,
   * which is the developer's view of an app, not the app.
   */
  /*
   * The preview, from the first moment — including before there is anything to
   * preview. Opening on a file listing means the answer to "is it working" is
   * one click away during the only stretch when nobody knows yet.
   */
  const [panel, setPanel] = useState<Panel>('preview');
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

  /*
   * Started without being asked. Generation ends with an application that is not
   * running, and a person who has just watched it be written should not then
   * have to find a button to see it. Guarded by a ref rather than by state so a
   * re-render cannot start a second container.
   */
  const autoStarted = useRef(false);
  const router = useRouter();

  /**
   * What the build is doing, while it has nothing to show yet.
   *
   * Read from the build itself rather than animated: each phrase is written by
   * the generator at the moment it enters that step, so an empty panel during a
   * two-minute generation becomes an account of what is happening. When files
   * appear the page is refreshed, which is what makes the preview come up on
   * its own rather than waiting to be asked for.
   */
  const [buildStage, setBuildStage] = useState<string | null>(null);

  /**
   * The preview server's own output.
   *
   * Where a compile error actually appears. Until this was read back, that
   * error lived only in the browser tab of whoever opened the preview — so
   * Reklu showed a blank frame and an empty Console, while the answer sat
   * inside the container.
   */
  const [serverLog, setServerLog] = useState('');
  const [fixing, setFixing] = useState(false);

  /**
   * A compile failure the reader can act on.
   *
   * The dev server keeps running when the application fails to compile — it
   * serves an error page — so Reklu's own state says everything is fine while
   * the frame shows a stack trace. Reading the log is how that becomes
   * something to do rather than something to look at.
   */
  const compileError = useMemo(() => compileErrorIn(serverLog), [serverLog]);

  /**
   * How the preview is being looked at.
   *
   * A generated page is meant to work at every width, and the only honest way
   * to check that is to look at it at those widths. The frame is narrowed
   * rather than the page being scaled, so what appears is the layout the
   * browser actually chooses at 390px — not a shrunken picture of the wide one.
   */
  const [device, setDevice] = useState<DeviceName>('desktop');
  const [route, setRoute] = useState('/');
  /** Bumped to remount the frame, which is what reloading it means. */
  const [reloadKey, setReloadKey] = useState(0);

  const routes = useMemo(() => siteRoutes(files.map((file) => file.path)), [files]);

  /* A page that no longer exists after an edit should not stay selected. */
  useEffect(() => {
    if (!routes.some((entry) => entry.path === route)) setRoute(routes[0]?.path ?? '/');
  }, [routes, route]);

  useEffect(() => {
    if (!livePreview) return;

    let cancelled = false;
    const read = async () => {
      try {
        const output = await previewLogsAction(buildId);
        if (!cancelled && output.trim().length > 0) setServerLog(output);
      } catch {
        // The Console simply stays as it was; nothing here is worth an alert.
      }
    };

    void read();
    const timer = setInterval(read, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [livePreview, buildId]);

  useEffect(() => {
    if (files.length > 0) return;

    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const progress = await fetchBuildProgress(buildId);
        if (cancelled || !progress) return;

        setBuildStage(
          progress.status === 'planning' || progress.status === 'generating'
            ? (progress.detail ?? 'Building')
            : null,
        );

        if (progress.fileCount > 0) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // Not worth reporting from a poll; generation reports its own failure.
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [files.length, buildId, router]);

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
  /*
   * Start it once, when there is something to show and nothing running. The ref
   * is what makes "once" true: state would let a re-render race and create a
   * second container for the same build.
   */
  useEffect(() => {
    if (autoStarted.current) return;
    if (files.length === 0 || livePreview || starting) return;
    autoStarted.current = true;
    void start();
  }, [files.length, livePreview, starting, start]);

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
    /*
      Shipping is a step, not a sidebar ornament. It sat in the pane where the
      conversation happens, competing with the brief and the log for the space
      those actually need.
    */
    { id: 'deploy', label: 'Deploy', icon: Rocket },
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

      {/*
        The file tree belongs to the code view, not to the workspace.
        
        It used to sit beside every panel, so a preview — the thing most people
        open this for — was permanently narrowed by a list of filenames nobody
        was reading at that moment. It now appears when the code does, and the
        preview gets the whole pane.
      */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/*
          `min-h-0` is load-bearing. A flex item in a column defaults to
          `min-height: auto`, which means "at least as tall as my content" — so
          without it this box grew to fit the whole file list, the panel inside
          it never overflowed, and nothing scrolled anywhere. The content simply
          extended past the screen and was clipped further out.
        */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
              <div className="flex h-full min-h-0">
                <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface/30 md:flex">
                  <h2 className="px-3 py-2.5 text-[0.6875rem] font-medium uppercase tracking-wider text-text-muted">
                    Files
                  </h2>
                  <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
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

                <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                  {selected ? (
                    <div>
                      <p className="sticky top-0 z-10 border-b border-border bg-canvas px-4 py-2 font-mono text-[0.6875rem] text-text-muted">
                        {selected.path}
                      </p>
                      <pre className="overflow-x-auto p-4">
                        <code className="font-mono text-[0.75rem] leading-relaxed">
                          {/*
                            Coloured by a lexer that knows comments and strings
                            take precedence over everything else — the mistake
                            that makes a naive highlighter mangle ordinary code.
                          */}
                          {tokenize(selected.content, languageFor(selected.path)).map(
                            (token, index) => (
                              <span key={index} className={TOKEN_CLASS[token.kind]}>
                                {token.text}
                              </span>
                            ),
                          )}
                        </code>
                      </pre>
                    </div>
                  ) : (
                    <p className="p-6 text-sm text-text-muted">Select a file to view it.</p>
                  )}
                </div>
              </div>
            ) : null}

            {panel === 'preview' ? (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
                  {/* ---- Width, on the left ---- */}
                  <div
                    role="radiogroup"
                    aria-label="Preview width"
                    className="inline-flex items-center gap-0.5 rounded-lg border border-border p-0.5"
                  >
                    {DEVICES.map(({ id, label, icon: Icon }) => (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={device === id}
                        title={label}
                        onClick={() => setDevice(id)}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                          device === id
                            ? 'bg-surface-raised text-text'
                            : 'text-text-muted hover:text-text'
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                        <span className="sr-only">{label}</span>
                      </button>
                    ))}
                  </div>

                  {/* ---- Which page, and reloading it, in the middle ---- */}
                  <div className="mx-auto inline-flex items-center gap-1 rounded-full border border-border px-1 py-0.5">
                    <button
                      type="button"
                      onClick={() => setReloadKey((value) => value + 1)}
                      disabled={!livePreview}
                      title="Reload the preview"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text disabled:opacity-40"
                    >
                      <RotateCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                      <span className="sr-only">Reload the preview</span>
                    </button>

                    {/*
                      Every page here comes from a file that defines it, so this
                      cannot offer one that 404s — which would make the menu
                      worse than not having it.
                    */}
                    {/*
                      Reklu's own menu rather than a native select. A select
                      renders as the operating system draws it — a grey list in
                      a light popup on a dark toolbar — and it is the one control
                      here that cannot be made to match anything around it.
                    */}
                    <Menu
                      label="Page"
                      panelClassName="w-56"
                      triggerClassName="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm text-text transition-colors hover:bg-surface-hover disabled:opacity-40"
                      trigger={
                        <>
                          <span className="max-w-[14rem] truncate">
                            {routes.find((entry) => entry.path === route)?.label ?? 'Homepage'}
                          </span>
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} />
                        </>
                      }
                    >
                      {(close) =>
                        routes.map((entry) => (
                          <MenuItem
                            key={entry.path}
                            onSelect={() => {
                              setRoute(entry.path);
                              close();
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                            {entry.path === route ? (
                              <Check className="h-3.5 w-3.5 shrink-0 text-accent" strokeWidth={2.5} />
                            ) : null}
                          </MenuItem>
                        ))
                      }
                    </Menu>
                  </div>

                  {/* ---- Out of Reklu, on the right ---- */}
                  <a
                    href={livePreview ? `${livePreview}${route === '/' ? '' : route}` : '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-disabled={!livePreview}
                    title="Open the preview in a new tab"
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text ${
                      livePreview ? '' : 'pointer-events-none opacity-40'
                    }`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                    <span className="sr-only">Open the preview in a new tab</span>
                  </a>

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
                    {livePreview ? 'Restart' : 'Start preview'}
                  </button>
                </div>

                {compileError && !previewError ? (
                  <div className="flex flex-wrap items-center gap-3 border-b border-danger/40 bg-danger/10 px-4 py-2">
                    <p className="min-w-0 flex-1 text-xs leading-relaxed text-text">
                      The application does not compile. The Console tab has the full output.
                    </p>
                    <button
                      type="button"
                      disabled={fixing}
                      onClick={() => {
                        setFixing(true);
                        void generateBuildAction(
                          buildId,
                          /*
                            The compiler's own words, not a paraphrase. It names
                            the file and the line, which is most of the fix.
                          */
                          `The application fails to compile with the following error. ` +
                            `Fix the cause and change nothing else.\n\n${compileError}`,
                        )
                          .then(() => router.refresh())
                          .finally(() => setFixing(false));
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-danger/40 px-2.5 py-1 text-xs text-text transition-colors hover:bg-danger/20 disabled:opacity-60"
                    >
                      {fixing ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
                      ) : null}
                      {fixing ? 'Fixing' : 'Fix this error'}
                    </button>
                  </div>
                ) : null}

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

                {livePreview && framingProblem ? (
                  <div className="p-6">
                    <p className="text-sm text-text">
                      This preview cannot be shown inside Reklu
                    </p>
                    <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-secondary">
                      {framingProblem}
                    </p>
                    <a
                      href={livePreview}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
                    >
                      Open the preview in a new tab
                    </a>
                  </div>
                ) : livePreview && blockedAsMixedContent(livePreview) ? (
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
                  /*
                    The frame is narrowed, not scaled. A scaled screenshot of the
                    wide layout would show what the page looks like shrunk; this
                    shows the layout the browser actually chooses at that width,
                    which is the only version worth checking.
                  */
                  <div
                    className={`min-h-0 flex-1 overflow-auto ${
                      device === 'desktop' ? '' : 'flex justify-center bg-surface/40 p-4'
                    }`}
                  >
                    <iframe
                      key={`${route}-${reloadKey}`}
                      src={`${livePreview}${route === '/' ? '' : route}`}
                      title="Application preview"
                      style={
                        DEVICES.find((entry) => entry.id === device)?.width
                          ? { width: DEVICES.find((entry) => entry.id === device)!.width! }
                          : undefined
                      }
                      /*
                        `allow-same-origin` is required, not a relaxation. Without
                        it the framed page has an opaque origin and every storage
                        access inside it throws, so a React app never hydrates and
                        the frame renders white.

                        It is safe because the preview is served from somewhere
                        else — the dangerous pairing with `allow-scripts` is a
                        document sharing the parent's origin, and `loadServerEnv`
                        refuses a configuration where that could happen.
                      */
                      sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
                      className={`border-0 bg-white ${
                        device === 'desktop'
                          ? 'h-full w-full'
                          : 'h-full max-w-full shrink-0 rounded-lg shadow-2xl shadow-black/40'
                      }`}
                    />
                  </div>
                ) : buildStage ? (
                  /*
                    The build, while it is happening. This panel was empty for
                    the whole of a generation — the one stretch where a person
                    most wants to know something is going on. The phrase is the
                    stage the generator is actually in, not a script.
                  */
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
                    <span
                      aria-hidden
                      className="h-8 w-8 animate-spin rounded-full border-2 border-border-strong border-t-accent motion-reduce:animate-none"
                    />
                    <p className="text-sm text-text">Building your project</p>
                    <p role="status" className="text-sm text-text-secondary">
                      {buildStage}
                    </p>
                    <p className="max-w-xs text-center text-xs leading-relaxed text-text-muted">
                      The preview opens here on its own once the application is written.
                    </p>
                  </div>
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
              (serverLog || previewOutput || consoleOutput).trim().length > 0 ? (
                <pre className="overflow-x-auto p-4">
                  <code className="font-mono text-[0.75rem] leading-relaxed text-text-secondary">
                    {serverLog || previewOutput || consoleOutput}
                  </code>
                </pre>
              ) : (
                <p className="p-6 text-sm text-text-muted">
                  No output yet. Install output and the dev server&rsquo;s own log appear
                  here — including compile errors.
                </p>
              )
            ) : null}

            {panel === 'deploy' ? (
              <div className="mx-auto max-w-xl p-6">
                <ExportPanel buildId={buildId} hasFiles={files.length > 0} />
              </div>
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
