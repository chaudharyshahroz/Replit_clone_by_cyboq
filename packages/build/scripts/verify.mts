/** Live verification of build checkpoints — the spec §33 safety property. */
import { eq } from 'drizzle-orm';
import {
  buildFiles,
  buildProjects,
  buildVersions,
  closeDatabase,
  db,
  users,
  workspaces,
} from '@reklu/database';
import {
  createCheckpoint,
  listCheckpoints,
  loadTree,
  restoreCheckpoint,
  mergeTree,
  parseGeneratedFiles,
} from '@reklu/build';
import { newId, slugify } from '@reklu/shared';

const check = (label: string, pass: boolean, detail = '') =>
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
const [user] = await db.select({ id: users.id }).from(users).limit(1);
if (!ws || !user) throw new Error('Sign up first.');

const buildId = newId('build');

try {
  console.log('\n1. Build project');
  await db.insert(buildProjects).values({
    id: buildId,
    workspaceId: ws.id,
    createdById: user.id,
    name: 'Verification Build',
    slug: `${slugify('Verification Build')}-${buildId.slice(-6)}`,
    target: 'web_app',
    status: 'draft',
    createdBy: user.id,
  });
  check('created', true);

  console.log('\n2. First checkpoint stores the whole tree');
  const v1 = await createCheckpoint({
    buildProjectId: buildId,
    workspaceId: ws.id,
    userId: user.id,
    files: [
      { path: 'package.json', content: '{"name":"app","version":"1.0.0"}', language: 'json' },
      { path: 'src/index.ts', content: 'export const version = 1;', language: 'typescript' },
      { path: 'src/router.ts', content: 'export const routes = ["/"];', language: 'typescript' },
    ],
    changeSummary: 'Initial generation',
  });
  check('version 1', v1.version.version === 1);
  check('all files stored', v1.fileCount === 3);
  check('all paths marked changed on first version', v1.changedPaths.length === 3);

  console.log('\n3. Second checkpoint diffs against the previous tree');
  const v2 = await createCheckpoint({
    buildProjectId: buildId,
    workspaceId: ws.id,
    userId: user.id,
    files: [
      { path: 'package.json', content: '{"name":"app","version":"1.0.0"}', language: 'json' },
      { path: 'src/index.ts', content: 'export const version = 2;', language: 'typescript' },
      { path: 'src/router.ts', content: 'export const routes = ["/"];', language: 'typescript' },
    ],
    changeSummary: 'Bumped version',
  });
  check('version 2', v2.version.version === 2);
  check('only the changed file is listed', v2.changedPaths.length === 1, v2.changedPaths.join(','));
  check('changed path is correct', v2.changedPaths[0] === 'src/index.ts');

  console.log('\n4. Current tree reflects the latest checkpoint');
  const current = await loadTree(buildId, ws.id);
  check('three files', current.length === 3);
  check('content updated', current.find((f) => f.path === 'src/index.ts')?.content.includes('version = 2') === true);

  console.log('\n5. Restore is append-only and recovers the old tree');
  const restored = await restoreCheckpoint({
    buildProjectId: buildId,
    workspaceId: ws.id,
    userId: user.id,
    version: 1,
  });
  check('restore created version 3', restored.version.version === 3);
  const afterRestore = await loadTree(buildId, ws.id);
  check('old content recovered', afterRestore.find((f) => f.path === 'src/index.ts')?.content.includes('version = 1') === true);
  const history = await listCheckpoints(buildId, ws.id);
  check('all three versions retained', history.length === 3);
  check('nothing was destroyed by the restore', history.some((v) => v.version === 2));

  console.log('\n6. Cross-workspace isolation');
  const otherWs = newId('workspace');
  await db.insert(workspaces).values({
    id: otherWs, name: 'Other', slug: `o-${otherWs.slice(-6)}`, ownerId: user.id,
  });
  check('tree not readable from another workspace', (await loadTree(buildId, otherWs)).length === 0);
  check('checkpoints not listable from another workspace', (await listCheckpoints(buildId, otherWs)).length === 0);
  await db.delete(workspaces).where(eq(workspaces.id, otherWs));

  console.log('\n7. An edit does not delete files it did not mention');
  const existing = await loadTree(buildId, ws.id);
  const generated = parseGeneratedFiles(
    '// src/index.ts\n```typescript\nexport const version = 99;\n```',
  );
  const merged = mergeTree(existing, generated.files);
  check('untouched files survive', merged.length === existing.length, `${merged.length} files`);
  check('edited file updated', merged.find((f) => f.path === 'src/index.ts')?.content.includes('99') === true);
  check('router.ts still present', merged.some((f) => f.path === 'src/router.ts'));

  console.log('\n8. Unsafe generated paths are rejected, safe ones kept');
  const mixed = parseGeneratedFiles(
    '// src/safe.ts\n```ts\nexport const ok = 1;\n```\n\n// ../../.env\n```text\nSECRET=leak\n```',
  );
  check('safe file kept', mixed.files.some((f) => f.path === 'src/safe.ts'));
  check('unsafe path rejected', mixed.rejected.length === 1);
  check('rejection has a reason', (mixed.rejected[0]?.reason.length ?? 0) > 0);

  console.log('\n9. Cleanup');
  await db.delete(buildFiles).where(eq(buildFiles.buildProjectId, buildId));
  await db.delete(buildProjects).where(eq(buildProjects.id, buildId));
  await db.delete(buildVersions).where(eq(buildVersions.buildProjectId, buildId));
  check('removed', true);
} finally {
  await closeDatabase();
}
