import type { Metadata, Viewport } from 'next';
import { THEME_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Reklu — One AI workspace for everything',
    template: '%s · Reklu',
  },
  description:
    'Use the world’s best AI models to research, create, build and get work done — without switching between tools.',
  openGraph: {
    title: 'Reklu — One AI workspace for everything',
    description:
      'Chat. Research. Create. Build. Ship. One workspace, every model, every tool.',
    siteName: 'Reklu',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#08080a' },
    { media: '(prefers-color-scheme: light)', color: '#fbfbfa' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Before the first paint. A theme applied from a component runs after
          hydration, by which time the wrong one has already been shown — and a
          flash of the opposite theme is the most noticeable bug a theme switch
          can have.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        {/* Spec §99: keyboard users should be able to skip repeated navigation. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-accent"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
