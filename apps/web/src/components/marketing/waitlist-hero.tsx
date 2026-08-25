import { WaitlistForm } from './waitlist-form';

/**
 * The landing page while Reklu is closed.
 *
 * It says the same thing the product page says, because it is the same product
 * — what changes is that the way in is a form instead of a button. It does not
 * promise a date, a price, or a place in a queue, since none of those is known.
 */
export function WaitlistHero() {
  return (
    <section id="join" className="relative overflow-hidden px-6 pb-24 pt-32 sm:pt-40">
      <div className="mx-auto max-w-3xl text-center">
        <p className="rise inline-flex items-center gap-2 rounded-full border border-border bg-surface/60 px-3 py-1.5 text-xs text-text-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Opening soon
        </p>

        <h1 className="rise display mt-7 text-balance text-5xl leading-[1.03] tracking-[-0.035em] text-text sm:text-6xl md:text-7xl [animation-delay:80ms]">
          Ask once.
          <br />
          Get the whole thing done.
        </h1>

        <p className="rise mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-text-secondary [animation-delay:160ms]">
          Research a market, build the app, write the deck — in one place, with whichever model is
          best for the step you are on. Reklu is not open yet. Leave your email and we will tell
          you the day it is.
        </p>

        <div className="rise mt-10 [animation-delay:240ms]">
          <WaitlistForm source="hero" />
        </div>
      </div>
    </section>
  );
}
