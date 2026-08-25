import { waitlistMode } from '@reklu/shared';
import { Features } from '@/components/marketing/features';
import { Footer } from '@/components/marketing/footer';
import { Hero } from '@/components/marketing/hero';
import { Nav } from '@/components/marketing/nav';
import { FinalCta, Unify } from '@/components/marketing/unify';
import { WaitlistHero } from '@/components/marketing/waitlist-hero';
import { Workflow } from '@/components/marketing/workflow';

/*
 * Read per request, not baked in. A statically rendered page would capture the
 * flag at build time, so turning the waitlist off would need a rebuild rather
 * than a restart — and this project has already been bitten once by a value
 * frozen into an image at build time.
 */
export const dynamic = 'force-dynamic';

export default function HomePage() {
  /*
   * One flag decides which front door this is. Everything below the fold is the
   * same either way — the product has not changed, only whether you can get in
   * yet — so the page is not duplicated to say so twice.
   */
  const waitlist = waitlistMode();

  return (
    /*
     * `data-surface="marketing"` is what globals.css keys the larger type
     * scale off. It sits here rather than on a layout because this page is the
     * only thing that gets it — the auth pages share this root layout and stay
     * at the product's size.
     */
    <div data-surface="marketing">
      <Nav waitlist={waitlist} />
      <main id="main">
        {waitlist ? <WaitlistHero /> : <Hero />}
        <Workflow />
        <Features />
        <Unify waitlist={waitlist} />
        <FinalCta waitlist={waitlist} />
      </main>
      <Footer waitlist={waitlist} />
    </div>
  );
}
