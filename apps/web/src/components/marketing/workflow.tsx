import { FileText, Globe, Rocket, Telescope } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Spec §92: communicate the *integrated* workflow, not a list of disconnected
 * features. The point being made visually is that each step consumes the
 * previous step's output — that continuity is the product.
 */
const STEPS: readonly {
  icon: LucideIcon;
  step: string;
  title: string;
  body: string;
  carries: string;
}[] = [
  {
    icon: Telescope,
    step: '01',
    title: 'Research the idea',
    body: 'Reklu plans the research, reads dozens of sources, cross-checks them, and cites every claim.',
    carries: '24 sources · 18 citations',
  },
  {
    icon: FileText,
    step: '02',
    title: 'Turn it into a report',
    body: 'The findings become an editable document or an investor deck — built from the same evidence.',
    carries: 'Research → Document',
  },
  {
    icon: Globe,
    step: '03',
    title: 'Build the product',
    body: 'Reklu writes a real application, previews it live, and edits it through conversation.',
    carries: 'Positioning → Landing page',
  },
  {
    icon: Rocket,
    step: '04',
    title: 'Ship it',
    body: 'Connect GitHub and a deployment provider, push the code, and get a live URL.',
    carries: 'Repository → Production',
  },
];

export function Workflow() {
  return (
    <section id="how" className="scroll-mt-20 border-t border-border bg-surface/30 py-24">
      <div className="reveal mx-auto max-w-6xl px-6">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-accent">How Reklu works</p>
          <h2 className="display mt-4 text-4xl text-text sm:text-5xl">
            An idea becomes finished work.
          </h2>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-text-secondary">
            Every step keeps the context of the one before it. Nothing is re-explained,
            re-pasted, or lost between tools.
          </p>
        </div>

        <ol className="mt-16 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ icon: Icon, step, title, body, carries }) => (
            <li key={step} className="group relative bg-canvas p-7 transition-colors hover:bg-surface">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-strong bg-surface-raised">
                  <Icon className="h-4.5 w-4.5 text-accent" strokeWidth={1.75} />
                </span>
                <span className="font-mono text-xs text-text-muted">{step}</span>
              </div>

              <h3 className="mt-6 text-base font-medium text-text">{title}</h3>
              <p className="mt-2.5 text-sm leading-relaxed text-text-secondary">{body}</p>

              <p className="mt-6 inline-flex rounded-md bg-surface-raised px-2 py-1 font-mono text-[0.6875rem] text-text-muted">
                {carries}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
