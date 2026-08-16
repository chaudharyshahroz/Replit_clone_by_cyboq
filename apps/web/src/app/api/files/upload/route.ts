/**
 * File upload (spec §59).
 *
 * Authenticate → resolve workspace → enforce the plan's size limit → validate
 * the bytes → store. Nothing is written before authorization, and the size
 * limit comes from the workspace's plan rather than a global constant.
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { defaultWorkspaceFor, requireWorkspace } from '@reklu/auth';
import { db, plans, subscriptions, type PlanLimits } from '@reklu/database';
import { errors, isRekluError, loadServerEnv, logger, toRekluError } from '@reklu/shared';
import { getSession } from '@/lib/auth-context';
import { ingestFile } from '@/lib/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const log = logger.child({ route: 'POST /api/files/upload' });

  try {
    const session = await getSession();
    if (!session) throw errors.unauthenticated();
    const user = session.user;

    const form = await request.formData();
    const entry = form.get('file');
    if (!(entry instanceof File)) {
      throw errors.validation('No file was included in the upload.');
    }

    const workspaceId =
      (form.get('workspaceId') as string | null) ??
      (await defaultWorkspaceFor(user.id))?.id;
    if (!workspaceId) throw errors.internal(`User ${user.id} has no workspace`);

    const access = await requireWorkspace(user, workspaceId);

    // Plan limit first, instance ceiling second — whichever is lower wins.
    const [planRow] = await db
      .select({ limits: plans.limits })
      .from(subscriptions)
      .innerJoin(plans, eq(subscriptions.planId, plans.id))
      .where(eq(subscriptions.workspaceId, access.workspaceId))
      .limit(1);

    const limits = planRow?.limits as PlanLimits | undefined;
    const instanceMaxMb = loadServerEnv().STORAGE_MAX_UPLOAD_MB;
    const maxBytes = Math.min(limits?.fileUploadMaxMb ?? instanceMaxMb, instanceMaxMb) * 1_048_576;

    // Reject on the declared size before buffering the whole body into memory.
    if (entry.size > maxBytes) {
      throw errors.payloadTooLarge(Math.round(maxBytes / 1_048_576));
    }

    const buffer = Buffer.from(await entry.arrayBuffer());

    const record = await ingestFile({
      user,
      workspaceId: access.workspaceId,
      filename: entry.name || 'upload',
      declaredType: entry.type || undefined,
      buffer,
      maxBytes,
    });

    log.info('File ingested', {
      fileId: record.id,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
    });

    return NextResponse.json({
      file: {
        id: record.id,
        filename: record.filename,
        contentType: record.contentType,
        sizeBytes: record.sizeBytes,
        status: record.status,
        statusDetail: record.statusDetail,
        // Whether this file can actually contribute to a prompt.
        usableInChat: record.status === 'ready',
      },
    });
  } catch (error) {
    const rekluError = toRekluError(error);
    if (!isRekluError(error)) log.error('Upload failed', { error });
    return NextResponse.json(rekluError.toClientJSON(), { status: rekluError.status });
  }
}
