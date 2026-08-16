/**
 * Live verification of the preview engine.
 *
 * Uses a dependency-free app so `npm install` is fast — the point is to prove
 * the pipeline (write tree → install → start dev server → serve HTTP → stop),
 * not to benchmark a framework install.
 */
import { eq } from 'drizzle-orm';
import {
  buildFiles,
  buildProjects,
  buildVersions,
  closeDatabase,
  db,
  sandboxes,
  users,
  workspaces,
} from '@reklu/database';
import {
  createCheckpoint,
  currentPreview,
  instrumentForVisualSelection,
  resolveElement,
  startPreview,
  stopPreview,
} from '@reklu/build';
import { newId, slugify } from '@reklu/shared';

const check = (label: string, pass: boolean, detail = '') =>
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
const [user] = await db.select({ id: users.id }).from(users).limit(1);
if (!ws || !user) throw new Error('Sign up first.');

const buildId = newId('build');

try {
  await db.insert(buildProjects).values({
    id: buildId,
    workspaceId: ws.id,
    createdById: user.id,
    name: 'Preview Verification',
    slug: `${slugify('Preview Verification')}-${buildId.slice(-6)}`,
    target: 'web_app',
    status: 'draft',
    createdBy: user.id,
  });

  console.log('\n1. Visual-selection instrumentation');
  const raw = [
    {
      path: 'package.json',
      content: JSON.stringify(
        { name: 'preview-check', version: '1.0.0', scripts: { dev: 'node server.js' } },
        null,
        2,
      ),
      language: 'json',
    },
    {
      path: 'server.js',
      content: [
        "const http = require('http');",
        "const port = process.env.PORT || 3000;",
        "http.createServer((req, res) => {",
        "  res.writeHead(200, { 'Content-Type': 'text/html' });",
        "  res.end('<html><body><h1 data-reklu-id=\"seed\">Reklu preview works</h1></body></html>');",
        "}).listen(port);",
      ].join('\n'),
      language: 'javascript',
    },
    {
      path: 'src/App.tsx',
      content: [
        'export default function App() {',
        '  return (',
        '    <div className="app">',
        '      <h1>Hello</h1>',
        '    </div>',
        '  );',
        '}',
      ].join('\n'),
      language: 'tsx',
    },
  ];

  const instrumented = instrumentForVisualSelection(raw);
  check('JSX instrumented', instrumented.instrumentedCount === 2, `${instrumented.instrumentedCount} elements`);
  check('non-JSX untouched', instrumented.files[1]!.content === raw[1]!.content);

  const anyId = Object.keys(instrumented.sourceMap)[0]!;
  const located = resolveElement(instrumented.sourceMap, anyId);
  check('element resolves to a source location', located !== undefined);
  check('location names a real file', located?.file === 'src/App.tsx');

  await createCheckpoint({
    buildProjectId: buildId,
    workspaceId: ws.id,
    userId: user.id,
    files: instrumented.files,
    changeSummary: 'Preview verification tree',
  });

  console.log('\n2. Preview starts and serves HTTP');
  const preview = await startPreview({ buildProjectId: buildId, workspaceId: ws.id });
  check('install succeeded', preview.installed, preview.installed ? '' : preview.output.slice(0, 120));
  check('reports non-isolated for the local driver', preview.isIsolated === false);
  check('url is on a separate port from Reklu', preview.url.length > 0 && !preview.url.includes(':3000'), preview.url);

  // Give the dev server a moment to bind.
  let body = '';
  let status = 0;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const response = await fetch(preview.url);
      status = response.status;
      body = await response.text();
      if (status === 200) break;
    } catch {
      // not up yet
    }
  }
  check('dev server responded 200', status === 200, `status ${status}`);
  check('served the generated content', body.includes('Reklu preview works'));

  console.log('\n3. Preview is tracked and stoppable');
  const live = await currentPreview(buildId, ws.id);
  check('reported as running', live !== undefined);

  await stopPreview(buildId, ws.id);
  const afterStop = await currentPreview(buildId, ws.id);
  check('reported as stopped', afterStop === undefined);

  let reachable = true;
  try {
    await fetch(preview.url, { signal: AbortSignal.timeout(1_500) });
  } catch {
    reachable = false;
  }
  check('port no longer serving', reachable === false);

  console.log('\n4. Cleanup');
  await db.delete(sandboxes).where(eq(sandboxes.buildProjectId, buildId));
  await db.delete(buildFiles).where(eq(buildFiles.buildProjectId, buildId));
  await db.delete(buildProjects).where(eq(buildProjects.id, buildId));
  await db.delete(buildVersions).where(eq(buildVersions.buildProjectId, buildId));
  check('removed', true);
} finally {
  await closeDatabase();
}
