/**
 * Download an artifact in a chosen format (spec §42–§43).
 *
 * Workspace scope is enforced by `loadArtifact`, which filters on it — an
 * artifact id alone is never authorization.
 */
import { NextResponse } from 'next/server';
import { loadArtifact } from '@reklu/artifacts';
import { availableFormats, exportArtifact, exportFilename, type ExportFormat } from '@reklu/create';
import { isRekluError, logger } from '@reklu/shared';
import { getAppContext } from '@/lib/auth-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
): Promise<Response> {
  const { artifactId } = await params;
  const { workspace } = await getAppContext();

  const loaded = await loadArtifact(artifactId, workspace.workspaceId);
  // Absent and not-yours are the same answer, so ids cannot be probed.
  if (!loaded) return new NextResponse('Not found', { status: 404 });

  const requested = new URL(request.url).searchParams.get('format') ?? '';
  const formats = availableFormats(loaded.artifact.type);

  if (!formats.includes(requested as ExportFormat)) {
    return NextResponse.json(
      {
        error: `Unsupported format. This artifact can be exported as: ${formats.join(', ')}.`,
      },
      { status: 400 },
    );
  }

  try {
    const file = await exportArtifact({
      artifactType: loaded.artifact.type,
      format: requested as ExportFormat,
      title: loaded.artifact.title,
      contentText: loaded.version.contentText,
      content: loaded.version.content,
    });

    const filename = exportFilename(loaded.artifact.title, file.extension);

    return new NextResponse(new Uint8Array(file.body), {
      headers: {
        'Content-Type': file.contentType,
        // `filename` is sanitised in exportFilename; the title reaching this
        // header unfiltered would be header injection.
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(file.body.byteLength),
        // A generated export is specific to one artifact version and should
        // never be served from a shared cache.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (isRekluError(error)) {
      return NextResponse.json({ error: error.userMessage }, { status: 400 });
    }
    logger.error('Artifact export failed', { error, artifactId, format: requested });
    return NextResponse.json({ error: 'The export could not be produced.' }, { status: 500 });
  }
}
