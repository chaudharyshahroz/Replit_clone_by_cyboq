/**
 * Authorized file serving.
 *
 * The local storage driver's "signed URL" points here, so possession of a key
 * grants nothing — workspace membership is re-checked on every read.
 *
 * Two headers do real work: `Content-Disposition: attachment` for anything that
 * could render as markup, and a restrictive CSP so a served file can never
 * execute in Reklu's origin.
 */
import { NextResponse } from 'next/server';
import { listWorkspaces } from '@reklu/auth';
import { safeDisplayFilename, StorageError } from '@reklu/storage';
import { errors, isRekluError, logger, toRekluError } from '@reklu/shared';
import { getSession } from '@/lib/auth-context';
import { readFileForUser } from '@/lib/files';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string[] }> },
): Promise<Response> {
  const log = logger.child({ route: 'GET /api/files' });

  try {
    const session = await getSession();
    if (!session) throw errors.unauthenticated();

    const { key } = await params;
    const storageKey = key.join('/');

    const workspaces = await listWorkspaces(session.user);
    const result = await readFileForUser(
      session.user,
      workspaces.map((w) => w.workspaceId),
      storageKey,
    );

    // Undefined covers "no such file" and "not your workspace" alike — a
    // stranger should not be able to distinguish them.
    if (!result) throw errors.notFound('File');

    const { record, body } = result;
    const metadata = record.metadata as { forceDownload?: boolean } | null;
    const requestedDownload = new URL(request.url).searchParams.has('download');
    const forceDownload = metadata?.forceDownload === true || requestedDownload;

    const filename = safeDisplayFilename(record.filename);

    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': record.contentType,
        'Content-Length': String(body.byteLength),
        'Content-Disposition': `${forceDownload ? 'attachment' : 'inline'}; filename="${filename}"`,
        // Belt and braces: even if a type were wrong, nothing here may execute.
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        // User content is private; never let a shared cache hold it.
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    if (error instanceof StorageError && error.code === 'NOT_FOUND') {
      return NextResponse.json(errors.notFound('File').toClientJSON(), { status: 404 });
    }
    const rekluError = toRekluError(error);
    if (!isRekluError(error)) log.error('File read failed', { error });
    return NextResponse.json(rekluError.toClientJSON(), { status: rekluError.status });
  }
}
