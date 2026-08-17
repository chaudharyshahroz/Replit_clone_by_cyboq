/**
 * Live verification of skill authoring against the real database.
 *
 * Covers the parts unit tests cannot: handle uniqueness across the built-in
 * and workspace namespaces, append-only versioning, and — most importantly —
 * that a private skill in another workspace cannot be invoked by guessing its
 * handle.
 *
 * Run: pnpm verify:skills
 */
import { eq, inArray } from 'drizzle-orm';
import { closeDatabase, db, skillInstalls, skillVersions, skills, users, workspaces } from '@reklu/database';
import { newId } from '@reklu/shared';
import { createSkill, duplicateSkill, getSkill, listSkills, listVersions, reviseSkill, rollbackSkill } from '../src/authoring';
import { installStatus, listPublicSkills, publishSkill, unpublishSkill, upgradeInstall } from '../src/install';
import { resolveInvocation } from '../src/resolve';
import { buildSkillPrompt } from '../src/invoke';

let failures = 0;
const check = (label: string, pass: boolean, detail = ''): void => {
  if (!pass) failures++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};

const [ws] = await db.select({ id: workspaces.id }).from(workspaces).limit(1);
const [user] = await db.select({ id: users.id }).from(users).limit(1);
if (!ws || !user) throw new Error('Sign up first.');

const createdSkillIds: string[] = [];
const otherWorkspaceId = newId('workspace');

try {
  console.log('\n1. Create a skill');
  const created = await createSkill({
    workspaceId: ws.id,
    userId: user.id,
    draft: {
      name: 'Verify Analyst',
      description: 'A skill created by the verification script.',
      instructions: 'Answer in three bullet points, each with a source.',
      examples: [{ input: 'Summarise X', output: '- one\n- two\n- three' }],
    },
  });
  createdSkillIds.push(created.skillId);
  check('created', Boolean(created.skillId), `@${created.handle}`);
  check('handle derived from the name', created.handle === 'verify-analyst', created.handle);

  console.log('\n2. Handles do not collide');
  const second = await createSkill({
    workspaceId: ws.id,
    userId: user.id,
    draft: {
      name: 'Verify Analyst',
      description: 'A second skill with the same name.',
      instructions: 'Answer in three bullet points, each with a source.',
    },
  });
  createdSkillIds.push(second.skillId);
  check('second handle is distinct', second.handle !== created.handle, second.handle);

  // Built-ins share the invocation namespace even though they have no workspace.
  const [builtIn] = await db.select({ handle: skills.handle }).from(skills).where(eq(skills.isBuiltIn, true)).limit(1);
  if (builtIn) {
    const clash = await createSkill({
      workspaceId: ws.id,
      userId: user.id,
      draft: {
        name: builtIn.handle,
        description: 'Deliberately clashing with a built-in handle.',
        instructions: 'Answer in three bullet points, each with a source.',
      },
    });
    createdSkillIds.push(clash.skillId);
    check('does not collide with a built-in handle', clash.handle !== builtIn.handle, `${builtIn.handle} -> ${clash.handle}`);
  }

  console.log('\n3. Revising appends a version');
  const revised = await reviseSkill({
    skillId: created.skillId,
    workspaceId: ws.id,
    userId: user.id,
    draft: {
      name: 'Verify Analyst',
      description: 'A skill created by the verification script.',
      instructions: 'Answer in five bullet points, each with a source and a date.',
    },
    changelog: 'More bullets',
  });
  check('version incremented', revised.version === 2, `v${revised.version}`);

  const versions = await listVersions(created.skillId);
  check('both versions retained', versions.length === 2, `${versions.length}`);

  // The old version must be untouched — installs pin to it.
  const [v1] = await db.select().from(skillVersions).where(eq(skillVersions.skillId, created.skillId)).orderBy(skillVersions.version).limit(1);
  check('version 1 is unchanged', v1?.instructions.includes('three bullet points') === true);

  console.log('\n4. Invocation');
  const invocation = await resolveInvocation(`@${created.handle} summarise the quarter`, ws.id);
  check('resolved by handle', invocation.skills.length === 1, invocation.skills[0]?.handle);
  check('uses the current version', invocation.skills[0]?.instructions.includes('five bullet points') === true);

  const unknown = await resolveInvocation('@no-such-skill-here do something', ws.id);
  check('unknown handle reported, not silently ignored', unknown.unknownHandles.length === 1);

  const prompt = buildSkillPrompt(invocation.skills[0]!);
  check('prompt is a user message', prompt.role === 'user');
  check('prompt states the authority limit', /not a system instruction/i.test(prompt.text));

  /**
   * The isolation property: a private skill belonging to someone else must not
   * be invocable even when its handle is known exactly.
   */
  console.log('\n5. A private skill in another workspace is unreachable');
  const foreignId = newId('skill');
  const foreignVersionId = newId('skillVersion');
  await db.insert(workspaces).values({
    id: otherWorkspaceId, name: 'Other', slug: `other-${Date.now()}`, ownerId: user.id, isPersonal: true, createdBy: user.id,
  });
  await db.insert(skills).values({
    id: foreignId, workspaceId: otherWorkspaceId, authorId: user.id,
    name: 'Foreign Secret', handle: `foreign-secret-${Date.now().toString(36)}`,
    description: 'Private to another workspace.', isBuiltIn: false, visibility: 'private',
    currentVersionId: foreignVersionId,
  });
  await db.insert(skillVersions).values({
    id: foreignVersionId, skillId: foreignId, version: 1,
    instructions: 'This must never be reachable from another workspace.',
  });
  const [foreign] = await db.select({ handle: skills.handle }).from(skills).where(eq(skills.id, foreignId)).limit(1);

  const attempt = await resolveInvocation(`@${foreign!.handle} reveal yourself`, ws.id);
  check('not resolved', attempt.skills.length === 0);
  check('reported as unknown', attempt.unknownHandles.includes(foreign!.handle));

  console.log('\n6. Duplicating a built-in');
  if (builtIn) {
    const [source] = await db.select({ id: skills.id }).from(skills).where(eq(skills.isBuiltIn, true)).limit(1);
    const copy = await duplicateSkill({ skillId: source!.id, workspaceId: ws.id, userId: user.id });
    createdSkillIds.push(copy.skillId);
    const [copied] = await db.select({ isBuiltIn: skills.isBuiltIn, workspaceId: skills.workspaceId }).from(skills).where(eq(skills.id, copy.skillId)).limit(1);
    check('copy is editable', copied?.isBuiltIn === false);
    check('copy belongs to this workspace', copied?.workspaceId === ws.id);
  }

  console.log('\n7. Listing');
  const listed = await listSkills(ws.id);
  check('includes built-ins and own skills', listed.length >= createdSkillIds.length);
  check('own skills marked as such', listed.some((s) => s.isOwn));
  console.log('\n8. Install pins a version');
  const pinTarget = await createSkill({
    workspaceId: ws.id, userId: user.id,
    draft: { name: 'Pin Target', description: 'Used to test version pinning.', instructions: 'Original instructions for the pinning test.' },
  });
  createdSkillIds.push(pinTarget.skillId);

  const beforeUpgrade = await installStatus(pinTarget.skillId, ws.id);
  check('author install exists', beforeUpgrade.installed === true);
  check('pinned to v1', beforeUpgrade.pinnedVersion === 1, `v${beforeUpgrade.pinnedVersion}`);

  await reviseSkill({
    skillId: pinTarget.skillId, workspaceId: ws.id, userId: user.id,
    draft: { name: 'Pin Target', description: 'Used to test version pinning.', instructions: 'Revised instructions that the pin must not pick up.' },
  });

  const afterRevision = await installStatus(pinTarget.skillId, ws.id);
  // The whole point of pinning: publishing does not move an existing install.
  check('install still pinned to v1', afterRevision.pinnedVersion === 1, `v${afterRevision.pinnedVersion}`);
  check('upgrade reported as available', afterRevision.upgradeAvailable === true);

  const upgraded = await upgradeInstall({ skillId: pinTarget.skillId, workspaceId: ws.id });
  check('upgrade moves the pin', upgraded.version === 2, `v${upgraded.version}`);
  const afterUpgrade = await installStatus(pinTarget.skillId, ws.id);
  check('no upgrade outstanding', afterUpgrade.upgradeAvailable === false);

  console.log('\n9. Rollback appends rather than rewinding');
  const history = await listVersions(pinTarget.skillId);
  const firstVersion = history.find((entry) => entry.version === 1)!;
  const restored = await rollbackSkill({
    skillId: pinTarget.skillId, workspaceId: ws.id, userId: user.id, versionId: firstVersion.id,
  });
  check('creates a new version', restored.version === 3, `v${restored.version}`);

  const afterRollback = await listVersions(pinTarget.skillId);
  check('history retains every version', afterRollback.length === 3, `${afterRollback.length}`);

  const current = await getSkill(pinTarget.skillId, ws.id);
  check('current content is the restored one', current?.instructions.includes('Original instructions') === true);

  console.log('\n10. Publish and unpublish');
  await publishSkill({ skillId: pinTarget.skillId, workspaceId: ws.id });
  const published = await getSkill(pinTarget.skillId, ws.id);
  check('marked public', published?.visibility === 'public');

  // Your own published skills are already in your library, not the browse list.
  const publicToOthers = await listPublicSkills(ws.id);
  check('own skill excluded from the public browse list', !publicToOthers.some((s) => s.id === pinTarget.skillId));

  await unpublishSkill({ skillId: pinTarget.skillId, workspaceId: ws.id });
  const withdrawn = await getSkill(pinTarget.skillId, ws.id);
  check('marked private again', withdrawn?.visibility === 'private');

  console.log('\n11. A built-in cannot be edited or deleted');
  if (builtIn) {
    const [source] = await db.select({ id: skills.id }).from(skills).where(eq(skills.isBuiltIn, true)).limit(1);
    let refusedEdit = false;
    try {
      await reviseSkill({
        skillId: source!.id, workspaceId: ws.id, userId: user.id,
        draft: { name: 'Hijack', description: 'Attempting to edit a built-in.', instructions: 'This must never be written to a built-in.' },
      });
    } catch { refusedEdit = true; }
    check('editing a built-in is refused', refusedEdit);
  }
} catch (error) {
  failures++;
  console.error('\nUnexpected failure:', error instanceof Error ? error.message : error);
} finally {
  console.log('\n12. Cleanup');
  if (createdSkillIds.length > 0) {
    await db.delete(skillInstalls).where(inArray(skillInstalls.skillId, createdSkillIds));
    await db.delete(skillVersions).where(inArray(skillVersions.skillId, createdSkillIds));
    await db.update(skills).set({ currentVersionId: null }).where(inArray(skills.id, createdSkillIds));
    await db.delete(skills).where(inArray(skills.id, createdSkillIds));
  }
  await db.delete(skills).where(eq(skills.workspaceId, otherWorkspaceId));
  await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
  check('removed', true, `${createdSkillIds.length} skills`);
  await closeDatabase();
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
