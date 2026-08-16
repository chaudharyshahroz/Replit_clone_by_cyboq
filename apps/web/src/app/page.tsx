import { Features } from '@/components/marketing/features';
import { Footer } from '@/components/marketing/footer';
import { Hero } from '@/components/marketing/hero';
import { Nav } from '@/components/marketing/nav';
import { FinalCta, Unify } from '@/components/marketing/unify';
import { Workflow } from '@/components/marketing/workflow';

export default function HomePage() {
  return (
    <>
      <Nav />
      <main id="main">
        <Hero />
        <Workflow />
        <Features />
        <Unify />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
