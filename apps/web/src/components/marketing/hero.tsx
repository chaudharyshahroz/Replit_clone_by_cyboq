import { HeroComposer } from '@/components/marketing/hero-composer';

/**
 * The hero is the product's own interaction.
 *
 * Reklu's whole claim is that one input reaches research, building and
 * creation, so the most honest opening is that input — working, and wired to
 * the real thing rather than to a demonstration of it.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pb-24 pt-20 sm:pt-28">
      {/* Ambient grid. Decorative, so hidden from assistive technology. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000,transparent)]"
      />

      <div className="relative mx-auto max-w-4xl text-center">
        <p className="rise inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-text-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          One workspace. Every model. Every tool.
        </p>

        <h1 className="rise display mt-7 text-balance text-5xl leading-[1.03] tracking-[-0.035em] text-text sm:text-6xl md:text-7xl [animation-delay:80ms]">
          Ask once.
          <br />
          Get the whole thing done.
        </h1>

        <p className="rise mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-text-secondary [animation-delay:160ms]">
          Research a market, build the app, write the deck — in one place, with
          whichever model is best for the step you are on.
        </p>

        <div className="rise mt-10 [animation-delay:240ms]">
          <HeroComposer />
        </div>
      </div>
    </section>
  );
}
