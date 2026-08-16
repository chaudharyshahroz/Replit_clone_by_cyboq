'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { createArtifact, deriveArtifact } from '@reklu/artifacts';
import { createProject } from '@reklu/projects';
import { db, researchSessions } from '@reklu/database';
import { errors } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';
import { loadResearch } from '@/lib/research';

/**
 * Research → execution (spec §26).
 *
 * This is the strategically important part of the product: research that ends
 * in a report is a dead end, research that becomes a document, a deck or a
 * project is work. Each conversion preserves provenance — the derived artifact
 * links back to the research that produced it — so "where did this come from?"
 * always has an answer.
 */

async function requireSession(sessionId: string) {
  const { user, workspace } = await getAppContext();
  const detail = await loadResearch(user, workspace.workspaceId, sessionId);
  if (!detail) throw errors.notFound('Research session', sessionId);
  if (!detail.session.report) {
    throw errors.validation('This research has no report to convert yet.');
  }
  return { user, workspace, detail };
}

/** Turn the report into an editable document artifact. */
export async function convertToDocumentAction(sessionId: string): Promise<void> {
  const { user, workspace, detail } = await requireSession(sessionId);
  let artifactId: string;

  if (detail.session.artifactId) {
    // The report artifact already exists; derive from it so the chain is
    // research → report → document rather than two unrelated rows.
    const derived = await deriveArtifact({
      sourceArtifactId: detail.session.artifactId,
      workspaceId: workspace.workspaceId,
      userId: user.id,
      type: 'document',
      title: detail.session.query.slice(0, 80),
      contentText: detail.session.report!,
    });
    artifactId = derived.artifact.id;
  } else {
    const created = await createArtifact({
      workspaceId: workspace.workspaceId,
      projectId: detail.session.projectId,
      userId: user.id,
      type: 'document',
      title: detail.session.query.slice(0, 80),
      contentText: detail.session.report!,
      sourceResearchId: sessionId,
    });
    artifactId = created.artifact.id;
  }

  redirect(`/artifacts/${artifactId}`);
}

/**
 * Turn the report into a presentation outline.
 *
 * Structural only: headings become slides. It does not invent content the
 * research did not produce, and it does not claim to be a designed deck —
 * generation with a real model is Milestone 9.
 */
export async function convertToPresentationAction(sessionId: string): Promise<void> {
  const { user, workspace, detail } = await requireSession(sessionId);
  const report = detail.session.report!;

  const slides: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | undefined;

  for (const line of report.split('\n')) {
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      if (current) slides.push(current);
      current = { title: heading[2]!, body: [] };
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line.trim());
    if (bullet && current) current.body.push(bullet[1]!);
    else if (line.trim().length > 0 && current && current.body.length < 6) {
      current.body.push(line.trim());
    }
  }
  if (current) slides.push(current);

  const outline =
    slides.length > 0
      ? slides
      : [{ title: detail.session.query.slice(0, 80), body: [report.slice(0, 400)] }];

  const title = `${detail.session.query.slice(0, 60)} — deck`;
  const contentText = outline
    .map((slide) => `## ${slide.title}\n\n${slide.body.map((b) => `- ${b}`).join('\n')}`)
    .join('\n\n');

  // Derive when a report artifact exists so the provenance chain is preserved;
  // otherwise (quick mode writes no artifact) create standalone. Branching on
  // the condition rather than catching the error keeps a genuine failure from
  // being silently swallowed as "no source artifact".
  const result = detail.session.artifactId
    ? await deriveArtifact({
        sourceArtifactId: detail.session.artifactId,
        workspaceId: workspace.workspaceId,
        userId: user.id,
        type: 'presentation',
        title,
        contentText,
      })
    : await createArtifact({
        workspaceId: workspace.workspaceId,
        projectId: detail.session.projectId,
        userId: user.id,
        type: 'presentation',
        title,
        contentText,
        sourceResearchId: sessionId,
      });

  redirect(`/artifacts/${result.artifact.id}`);
}

/**
 * Start a project from the research, carrying the report in as context.
 *
 * This is the "research leads to execution" path: the new project's
 * instructions reference the findings, so subsequent work inherits them.
 */
export async function convertToProjectAction(sessionId: string): Promise<void> {
  const { user, workspace, detail } = await requireSession(sessionId);

  const project = await createProject({
    workspaceId: workspace.workspaceId,
    userId: user.id,
    name: detail.session.query.slice(0, 80),
    description: `Started from research run on ${detail.session.createdAt.toLocaleDateString()}.`,
    instructions: [
      'This project began from a research report. Its findings are below.',
      'Treat them as established context unless newer information contradicts them.',
      '',
      detail.session.report!.slice(0, 4_000),
    ].join('\n'),
  });

  // Move the report artifact into the new project so it travels with the work.
  if (detail.session.artifactId) {
    const { artifacts } = await import('@reklu/database');
    await db
      .update(artifacts)
      .set({ projectId: project.id })
      .where(eq(artifacts.id, detail.session.artifactId));
  }

  await db
    .update(researchSessions)
    .set({ projectId: project.id })
    .where(eq(researchSessions.id, sessionId));

  redirect(`/projects/${project.id}`);
}
