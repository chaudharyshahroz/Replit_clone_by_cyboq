import { loadServerEnv } from '@reklu/shared';

/**
 * Whether the running app can actually frame a preview.
 *
 * Reklu's Content-Security-Policy decides what may be framed, and it is fixed
 * when the image is built — `next build` evaluates `headers()` and freezes the
 * result. So setting `SANDBOX_PREVIEW_DOMAIN` at run time changes where
 * previews are served and not whether the browser will show them, and the
 * symptom is a blank frame saying "this content is blocked" with nothing to
 * connect it to a build argument.
 *
 * Comparing the two values turns that into a sentence naming the fix.
 */
export function previewFramingProblem(): string | null {
  const configured = loadServerEnv().SANDBOX_PREVIEW_DOMAIN?.trim() ?? '';
  if (!configured) return null;

  /* Inlined at build time by next.config's `env`, not read at run time. */
  const built = process.env.REKLU_BUILT_PREVIEW_DOMAIN?.trim() ?? '';
  if (built === configured) return null;

  return built
    ? `This image was built to frame previews from ${built}, but previews are now served from ${configured}. Rebuild with SANDBOX_PREVIEW_DOMAIN=${configured} so the security policy matches.`
    : `This image was built without a preview domain, so the security policy will not allow ${configured} to be framed. Rebuild with SANDBOX_PREVIEW_DOMAIN=${configured} set — it is read while compiling, not at run time.`;
}
