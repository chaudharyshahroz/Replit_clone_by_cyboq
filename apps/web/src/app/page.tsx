import { Features } from '@/components/marketing/features';
import { Footer } from '@/components/marketing/footer';
import { Hero } from '@/components/marketing/hero';
import { Nav } from '@/components/marketing/nav';
import { FinalCta, Unify } from '@/components/marketing/unify';
import { Workflow } from '@/components/marketing/workflow';

export default function HomePage() {
  return (
    /*
     * `data-surface="marketing"` is what globals.css keys the larger type
     * scale off. It sits here rather than on a layout because this page is the
     * only thing that gets it — the auth pages share this root layout and stay
     * at the product's size.
     */
    <div data-surface="marketing">
      <Nav />
      <main id="main">
        <Hero />
        <Workflow />
        <Features />
        <Unify />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
