import {
  Blocks,
  Boxes,
  FolderKanban,
  Layers,
  Plug,
  Telescope,
  Wand2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/** Spec §93. */
const FEATURES: readonly {
  icon: LucideIcon;
  title: string;
  body: string;
  wide?: boolean;
}[] = [
  {
    icon: Layers,
    title: 'Every AI model',
    body: 'Choose your model, or let Reklu Auto pick the right one for each request — reasoning, coding, vision, long context, or speed.',
    wide: true,
  },
  {
    icon: Telescope,
    title: 'Deep Research',
    body: 'Find, analyse and understand information with real sources and verifiable citations.',
  },
  {
    icon: Blocks,
    title: 'Build anything',
    body: 'Websites, web apps and mobile apps — generated, previewed, and edited by conversation.',
  },
  {
    icon: Wand2,
    title: 'Create',
    body: 'Documents, presentations, images and video, all reusable across your projects.',
  },
  {
    icon: FolderKanban,
    title: 'Projects',
    body: 'Persistent context for everything you are working on: files, memory, research and builds.',
  },
  {
    icon: Boxes,
    title: 'Skills',
    body: 'Reusable AI expertise you can install, create, and share with your team.',
  },
  {
    icon: Plug,
    title: 'Connections',
    body: 'Let Reklu work with the tools you already use — GitHub, Vercel, Supabase, and any MCP server.',
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-border py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-accent">Capabilities</p>
          <h2 className="display mt-4 text-4xl text-text sm:text-5xl">
            Powerful, without feeling complicated.
          </h2>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body, wide }) => (
            <article
              key={title}
              className={`rounded-xl border border-border bg-surface/40 p-7 transition-colors hover:border-border-strong hover:bg-surface ${
                wide ? 'lg:col-span-2' : ''
              }`}
            >
              <Icon className="h-5 w-5 text-accent" strokeWidth={1.75} />
              <h3 className="mt-5 text-base font-medium text-text">{title}</h3>
              <p className="mt-2.5 max-w-md text-sm leading-relaxed text-text-secondary">{body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
