import { compileDesignStyles, type DesignEngineV4 } from '@reklu/design-intelligence';
import type { GeneratedFile } from './parse';

/** Compiler-owned, dependency-free media primitive. A fallback never masquerades as a loaded asset. */
export const BRAND_IMAGE_SOURCE = `'use client';
import { useEffect, useState } from 'react';
type Props = { src: string; alt: string; aspectRatio?: string; fit?: 'cover' | 'contain'; role?: 'critical' | 'optional'; className?: string };
export function BrandImage({ src, alt, aspectRatio = '4 / 3', fit = 'cover', role = 'optional', className = '' }: Props) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [retry, setRetry] = useState({ src, attempt: 0 });
  const attempt = retry.src === src ? retry.attempt : 0;
  const failed = !src || failedSrc === src;
  // First preview may arrive before the background asset worker. Retry only
  // compiler-owned local assets, for at most five minutes, without hiding failure.
  useEffect(() => {
    if (!failed || !src.startsWith('/generated/') || attempt >= 20) return;
    const timer = setTimeout(() => { setRetry({ src, attempt: attempt + 1 }); setFailedSrc(null); }, 15000);
    return () => clearTimeout(timer);
  }, [failed, src, attempt]);
  const renderedSrc = attempt ? src + (src.includes('?') ? '&' : '?') + 'rk_asset_retry=' + attempt : src;
  return <figure className={'rk-media ' + className} style={{ aspectRatio, margin: 0 }} data-asset-priority={role} data-asset-status={failed ? 'failed' : loadedSrc === src ? 'loaded' : 'loading'}>
    {failed ? <div className="rk-media-fallback" role="img" aria-label={alt}><span>{alt}</span><small style={{ display: 'block' }}>Image unavailable</small></div> :
    <img key={renderedSrc} src={renderedSrc} alt={alt} loading={role === 'critical' ? 'eager' : 'lazy'} decoding="async" style={{ objectFit: fit }} onLoad={event => { if (event.currentTarget.naturalWidth > 0 && event.currentTarget.naturalHeight > 0) setLoadedSrc(src); else setFailedSrc(src); }} onError={() => setFailedSrc(src)} />}
  </figure>;
}
export default BrandImage;
`;

/** Actual compilation, not a suggestion to the model. Existing unrelated files are preserved. */
export function compileDesignTree(
  files: readonly GeneratedFile[],
  engine: DesignEngineV4,
): readonly GeneratedFile[] {
  const layout = files.find((f) => /^(?:src\/)?app\/layout\.[jt]sx$/.test(f.path));
  if (!layout) return files; // Imported/non-Next projects retain their own styling pipeline.
  const app = layout.path.slice(0, layout.path.lastIndexOf('/'));
  const root = app.startsWith('src/') ? 'src/' : '';
  const artifacts: GeneratedFile[] = [
    { path: `${app}/reklu-design.css`, language: 'css', content: compileDesignStyles(engine) },
    {
      path: `${root}components/reklu/BrandImage.tsx`,
      language: 'tsx',
      content: BRAND_IMAGE_SOURCE,
    },
    {
      path: '.reklu/design-engine.json',
      language: 'json',
      content: JSON.stringify(engine, null, 2),
    },
  ];
  const paths = new Set(artifacts.map((f) => f.path));
  const result = files
    .filter((f) => !paths.has(f.path))
    .map((f) => {
      if (f.path !== layout.path || /import\s*['"]\.\/reklu-design\.css['"]/.test(f.content))
        return f;
      // Keep client/server directives first; import after existing CSS where possible.
      const cssImports = [...f.content.matchAll(/import\s*['"][^'"\n]+\.css['"];?/g)];
      const last = cssImports.at(-1);
      const directive = f.content.match(/^\s*['"]use (?:client|server)['"];?\s*/);
      const offset = last ? last.index! + last[0].length : (directive?.[0].length ?? 0);
      return {
        ...f,
        content:
          f.content.slice(0, offset) + '\nimport "./reklu-design.css";\n' + f.content.slice(offset),
      };
    });
  return [...result, ...artifacts];
}
