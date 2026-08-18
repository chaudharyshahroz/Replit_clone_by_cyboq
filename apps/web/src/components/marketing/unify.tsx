import { ArrowRight, Check } from 'lucide-react';
import { LogoMark } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';

/**
 * Spec §94: make the consolidation obvious visually, without naming or
 * attacking competitors. The left column lists the *jobs* people currently
 * spread across separate products; the right column is one workspace.
 */
const SCATTERED = [
  'One tool for chat',
  'Another for research',
  'Another for coding',
  'Another for presentations',
  'Another for images',
  'Another for deployment',
] as const;

const UNIFIED = [
  'Every model in one place',
  'Research with real citations',
  'Build and preview real apps',
  'Documents, decks and media',
  'Projects that remember',
  'Ship to production',
] as const;

export function Unify() {
  return (
    <section id="why" className="scroll-mt-20 border-t border-border bg-surface/30 py-24">
      <div className="reveal mx-auto max-w-6xl px-6">
        <div className="reveal mx-auto max-w-2xl text-center">
          <h2 className="display text-4xl text-text sm:text-5xl">
            Six subscriptions, or one workspace.
          </h2>
          <p className="mt-5 text-pretty text-lg leading-relaxed text-text-secondary">
            The cost of switching tools is not the subscriptions. It is the context you lose
            every time you move between them.
          </p>
        </div>

        <div className="mt-16 grid items-stretch gap-6 lg:grid-cols-[1fr_auto_1fr]">
          {/* Before */}
          <div className="rounded-xl border border-border bg-canvas p-8">
            <p className="text-xs font-medium uppercase tracking-widest text-text-muted">
              Today
            </p>
            <ul className="mt-6 space-y-3">
              {SCATTERED.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-text-secondary">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong"
                  />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-border pt-5 text-sm text-text-muted">
              Context resets at every boundary.
            </p>
          </div>

          {/* Connector */}
          <div className="flex items-center justify-center" aria-hidden="true">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-strong bg-surface-raised">
              <ArrowRight className="h-4 w-4 text-accent lg:rotate-0 rotate-90" strokeWidth={2} />
            </span>
          </div>

          {/* After */}
          <div className="relative rounded-xl border border-accent-border bg-canvas p-8">
            <div className="flex items-center gap-2">
              <LogoMark className="h-4 w-4" />
              <p className="text-xs font-medium uppercase tracking-widest text-accent">
                With Reklu
              </p>
            </div>
            <ul className="mt-6 space-y-3">
              {UNIFIED.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm text-text">
                  <Check className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.25} />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-8 border-t border-border pt-5 text-sm text-text-secondary">
              One project carries everything forward.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section id="start" className="scroll-mt-20 border-t border-border py-28">
      <div className="reveal mx-auto max-w-2xl px-6 text-center">
        <h2 className="display text-4xl text-text sm:text-5xl">
          Chat. Research. Create. Build. Ship.
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-text-secondary">
          Reklu turns an idea into completed work.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href="/signup" size="lg">
            Start with Reklu
            <ArrowRight className="h-4 w-4" strokeWidth={2} />
          </ButtonLink>
          {/*
            This said "See pricing" and pointed at /pricing, which does not
            exist — and cannot honestly be built yet, because plan prices live
            in Whop rather than in this repository. Inventing numbers for the
            page would be the fabricated detail the spec forbids, so the second
            action is one that is true today.
          */}
          <ButtonLink href="#how" variant="secondary" size="lg">
            See how it works
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
