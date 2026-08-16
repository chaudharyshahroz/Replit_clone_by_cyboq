/** Live verification of M3: projects, memory, retrieval, artifacts. */
import { eq } from 'drizzle-orm';
import {
  artifacts as artifactsTable,
  closeDatabase,
  db,
  fileChunks,
  files,
  projectMemories,
  projects,
  users,
  workspaces,
} from '@reklu/database';
import {
  assembleProjectContext,
  approveMemory,
  createProject,
  forgetMemory,
  indexFile,
  listMemories,
  listProjects,
  recall,
  remember,
  updateProject,
} from '@reklu/projects';
import {
  createArtifact,
  deriveArtifact,
  listVersions,
  loadArtifact,
  restoreVersion,
  reviseArtifact,
} from '@reklu/artifacts';
import { newId } from '@reklu/shared';

const check = (label: string, pass: boolean, detail = '') =>
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);

const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
const [user] = await db.select({ id: users.id }).from(users).limit(1);
if (!ws || !user) throw new Error('Sign up first.');

let projectId = '';
let otherProjectId = '';
let artifactId = '';
let fileId = '';

try {
  console.log('\n1. Project creation');
  const project = await createProject({
    workspaceId: ws.id,
    userId: user.id,
    name: 'M3 Verification Project',
    instructions: 'Always answer in British English. Prefer tables over prose.',
  });
  projectId = project.id;
  check('created', Boolean(project.id));
  check('slug generated', project.slug.startsWith('m3-verification-project'), project.slug);
  check('creator is a member', (await listProjects(ws.id, user.id)).some((p) => p.project.id === projectId));

  console.log('\n2. Memory: user-stated is auto-approved, inferred is not');
  const stated = await remember({
    projectId, workspaceId: ws.id, userId: user.id,
    kind: 'fact', source: 'user',
    content: 'The launch deadline is 14 November 2026.',
  });
  const inferred = await remember({
    projectId, workspaceId: ws.id,
    kind: 'fact', source: 'inferred',
    content: 'The team probably prefers Postgres over MySQL.',
  });
  check('user memory auto-approved', stated.approvedAt !== null);
  check('inferred memory NOT approved', inferred.approvedAt === null);

  console.log('\n3. Unapproved memories never reach context');
  const recalled = await recall({ projectId, workspaceId: ws.id, query: 'deadline launch date' });
  const contents = recalled.map((r) => r.memory.content);
  check('approved memory recalled', contents.some((c) => c.includes('14 November')));
  check('unapproved memory excluded', !contents.some((c) => c.includes('MySQL')));

  console.log('\n4. Approval admits it');
  await approveMemory(inferred.id, ws.id, user.id);
  const after = await recall({ projectId, workspaceId: ws.id, query: 'database preference Postgres MySQL' });
  check('approved inference now recalled', after.map((r) => r.memory.content).some((c) => c.includes('MySQL')));

  console.log('\n5. Instructions are always included, regardless of query');
  const instruction = await remember({
    projectId, workspaceId: ws.id, userId: user.id,
    kind: 'instruction', source: 'user',
    content: 'Never use the word "leverage".',
  });
  const unrelated = await recall({ projectId, workspaceId: ws.id, query: 'zebra giraffe unrelated nonsense' });
  const alwaysOnes = unrelated.filter((r) => r.matchedBy === 'always');
  check('instruction included for unrelated query', alwaysOnes.some((r) => r.memory.id === instruction.id));

  console.log('\n6. File indexing and passage retrieval');
  fileId = newId('file');
  await db.insert(files).values({
    id: fileId, workspaceId: ws.id, projectId, uploadedBy: user.id,
    filename: 'architecture.md',
    storageKey: `${ws.id}/uploads/${fileId}`,
    contentType: 'text/plain', sizeBytes: 400, checksum: newId('file'),
    status: 'ready',
    extractedText:
      'Reklu uses PostgreSQL with pgvector for semantic retrieval. ' +
      'Redis carries the job queue but Postgres holds the durable record. ' +
      'The sandbox never runs generated code on the application server. '.repeat(20),
  });
  const indexed = await indexFile(fileId);
  check('file chunked', indexed.chunks > 0, `${indexed.chunks} chunks`);
  const chunkRows = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
  check('chunks persisted', chunkRows.length === indexed.chunks);
  check('chunks scoped to project', chunkRows.every((c) => c.projectId === projectId));

  console.log('\n7. Indexing is idempotent');
  const reindexed = await indexFile(fileId);
  const afterRows = await db.select().from(fileChunks).where(eq(fileChunks.fileId, fileId));
  check('re-index does not duplicate', afterRows.length === reindexed.chunks, `${afterRows.length} chunks`);

  console.log('\n8. Context assembly');
  const context = await assembleProjectContext({
    projectId, workspaceId: ws.id,
    query: 'which database does Reklu use for semantic retrieval?',
  });
  check('context assembled', Boolean(context));
  check('instructions included', context!.contextBlock!.includes('British English'));
  check('memories included', context!.memories.length > 0);
  check('passages retrieved', context!.passages.length > 0, `${context!.passages.length} passages`);
  check('documents fenced as untrusted', context!.contextBlock!.includes('<document filename='));
  check('warns not to treat docs as instructions', /not as instructions/i.test(context!.contextBlock!));

  console.log('\n9. Context respects a token budget');
  const roomy = await assembleProjectContext({
    projectId, workspaceId: ws.id, query: 'PostgreSQL pgvector semantic retrieval',
  });
  check('retrieves passages when relevant', roomy!.passages.length > 0);
  check('not truncated when everything fits', roomy!.truncated === false);

  const tiny = await assembleProjectContext({
    projectId, workspaceId: ws.id,
    query: 'PostgreSQL pgvector semantic retrieval', budgetTokens: 20,
  });
  check('budget enforced', tiny!.estimatedTokens <= 20, `${tiny!.estimatedTokens} tokens`);
  check('truncation reported when content is dropped', tiny!.truncated);
  check('dropped content is actually absent', tiny!.passages.length < roomy!.passages.length);

  console.log('\n10. Cross-workspace isolation');
  const otherWs = newId('workspace');
  await db.insert(workspaces).values({
    id: otherWs, name: 'Other', slug: `other-${otherWs.slice(-6)}`, ownerId: user.id,
  });
  const otherProject = await createProject({
    workspaceId: otherWs, userId: user.id, name: 'Other Project',
  });
  otherProjectId = otherProject.id;
  const leaked = await assembleProjectContext({
    projectId, workspaceId: otherWs, query: 'database',
  });
  check('project not readable from another workspace', leaked === undefined);
  const leakedMemories = await listMemories(projectId, otherWs);
  check('memories not readable from another workspace', leakedMemories.length === 0);

  console.log('\n11. Artifacts: create, revise, restore');
  const created = await createArtifact({
    workspaceId: ws.id, projectId, userId: user.id,
    type: 'document', title: 'Launch Plan',
    contentText: 'Version one content.',
  });
  artifactId = created.artifact.id;
  check('created at version 1', created.version.version === 1);
  check('current version points at it', created.artifact.currentVersionId === created.version.id);

  const revised = await reviseArtifact({
    artifactId, workspaceId: ws.id, userId: user.id,
    contentText: 'Version two content.', changeSummary: 'Expanded the timeline',
  });
  check('revision is version 2', revised.version.version === 2);
  check('content updated', revised.version.contentText === 'Version two content.');

  const restored = await restoreVersion({ artifactId, workspaceId: ws.id, userId: user.id, version: 1 });
  check('restore creates version 3 (append-only)', restored.version.version === 3);
  check('restored content matches v1', restored.version.contentText === 'Version one content.');
  const versions = await listVersions(artifactId, ws.id);
  check('all three versions retained', versions.length === 3);

  console.log('\n12. Artifact derivation preserves provenance');
  const derived = await deriveArtifact({
    sourceArtifactId: artifactId, workspaceId: ws.id, userId: user.id,
    type: 'presentation', title: 'Launch Deck', contentText: 'Slide one.',
  });
  check('derived artifact created', derived.artifact.type === 'presentation');
  check('links back to source', derived.artifact.derivedFromArtifactId === artifactId);
  check('inherits the project', derived.artifact.projectId === projectId);

  console.log('\n13. Artifacts are workspace-scoped');
  check('not loadable from another workspace', (await loadArtifact(artifactId, otherWs)) === undefined);

  console.log('\n14. Forgetting a memory removes it from context');
  await forgetMemory(stated.id, ws.id, user.id);
  const post = await recall({ projectId, workspaceId: ws.id, query: 'deadline launch date' });
  check('forgotten memory not recalled', !post.map((r) => r.memory.content).some((c) => c.includes('14 November')));

  console.log('\n15. Project update');
  const renamed = await updateProject(projectId, ws.id, user.id, { name: 'Renamed Project' });
  check('name updated', renamed.name === 'Renamed Project');

  console.log('\n16. Cleanup');
  await db.delete(fileChunks).where(eq(fileChunks.fileId, fileId));
  await db.delete(files).where(eq(files.id, fileId));
  await db.delete(projectMemories).where(eq(projectMemories.projectId, projectId));
  await db.delete(artifactsTable).where(eq(artifactsTable.projectId, projectId));
  await db.delete(projects).where(eq(projects.id, projectId));
  await db.delete(projects).where(eq(projects.id, otherProjectId));
  await db.delete(workspaces).where(eq(workspaces.id, otherWs));
  check('cleaned up', true);
} finally {
  await closeDatabase();
}
