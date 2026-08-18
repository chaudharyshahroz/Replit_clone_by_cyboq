import {
  Blocks,
  Bot,
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
    body: 'Real sources with citations checked against what was actually retrieved. A claim Reklu cannot source is removed, not softened.',
  },
  {
    icon: Blocks,
    title: 'Build anything',
    body: 'Websites and apps, generated and previewed live. Generated code runs isolated — never on Reklu.',
  },
  {
    icon: Wand2,
    title: 'Create',
    body: 'Documents, slide decks and images — exported as real .docx and .pptx files, not screenshots.',
  },
  {
    icon: Bot,
    title: 'Agents',
    body: 'Give Reklu an objective. It plans the steps, shows you the plan, and asks before anything changes data.',
  },
  {
    icon: FolderKanban,
    title: 'Projects',
    body: 'Files, memory and history that persist across chats — so you stop re-explaining yourself every session.',
  },
  {
    icon: Boxes,
    title: 'Skills',
    body: 'Save an instruction once, invoke it anywhere with @handle. Versioned, so improving one never breaks someone mid-task.',
  },
  {
    icon: Plug,
    title: 'Connections',
    body: 'GitHub, Vercel, Supabase and any MCP server. Every tool arrives switched off, and anything that changes data asks first.',
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-t border-border py-24">
      <div className="reveal mx-auto max-w-6xl px-6">
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
