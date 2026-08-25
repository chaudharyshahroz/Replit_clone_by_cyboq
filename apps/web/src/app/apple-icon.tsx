import { ImageResponse } from 'next/og';
import { markBody } from '@/components/brand/logo';

/**
 * The home-screen icon.
 *
 * A PNG, unlike `icon.svg`, because iOS will not take an SVG here — and on a
 * white ground, because iOS composites a home-screen icon onto whatever it
 * likes and a transparent mark can land on a colour that swallows it.
 *
 * Rendered at build time from the same paths the component draws, so the two
 * cannot drift into being different logos.
 */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="132" height="132">${markBody('#FF4A0D')}</svg>`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#ffffff',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`} alt="" width={132} height={132} />
      </div>
    ),
    size,
  );
}
