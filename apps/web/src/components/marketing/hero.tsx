import { ArrowRight, Paperclip, Sparkles, Telescope, Wrench } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';

/**
 * A still of the Reklu composer.
 *
 * Presentational only — deliberately non-interactive and hidden from assistive
 * technology, so it reads as an illustration rather than a control surface that
 * does nothing when clicked (spec §137).
 */
function ComposerStill() {
  return (
    <figure className="mx-auto mt-16 w-full max-w-3xl rise [animation-delay:240ms]">
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-2xl shadow-black/40"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-border-strong" />
          <span className="ml-2 text-xs text-text-muted">New chat</span>
        </div>

        <div className="px-5 pb-4 pt-6">
          <p className="text-[15px] leading-relaxed text-text-secondary">
            Research the AI customer-support market, then build me a landing page for a
            product that wins in it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-text-secondary">
            <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} />
            Attach
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-border bg-accent-subtle px-2.5 py-1.5 text-xs font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
            Reklu Auto
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-text-secondary">
            <Telescope className="h-3.5 w-3.5" strokeWidth={1.75} />
            Research
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border-strong px-2.5 py-1.5 text-xs text-text-secondary">
            <Wrench className="h-3.5 w-3.5" strokeWidth={1.75} />
            Build
          </span>

          <span className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent">
            <ArrowRight className="h-4 w-4 text-on-accent" strokeWidth={2.25} />
          </span>
        </div>
      </div>

      <figcaption className="mt-4 text-center text-xs text-text-muted">
        One request. Reklu routes the model, runs the research, and builds the result.
      </figcaption>
    </figure>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="grid-backdrop absolute inset-0 -z-10" />

      <div className="mx-auto max-w-6xl px-6 pb-24 pt-20 sm:pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="rise inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-3 py-1.5 text-xs text-text-secondary">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />
            One workspace. Every model. Every tool.
          </p>

          <h1 className="display rise mt-8 text-5xl text-text sm:text-6xl md:text-7xl [animation-delay:80ms]">
            One AI workspace
            <br />
            for everything.
          </h1>

          <p className="rise mx-auto mt-7 max-w-xl text-pretty text-lg leading-relaxed text-text-secondary [animation-delay:160ms]">
            Use the world’s best AI models to research, create, build and get work done —
            without switching between tools.
          </p>

          <div className="rise mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row [animation-delay:200ms]">
            <ButtonLink href="/signup" size="lg">
              Start with Reklu
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </ButtonLink>
            <ButtonLink href="#how" variant="secondary" size="lg">
              See how it works
            </ButtonLink>
          </div>
        </div>

        <ComposerStill />
      </div>
    </section>
  );
}
