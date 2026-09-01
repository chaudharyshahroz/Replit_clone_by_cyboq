import { describe, expect, it } from 'vitest';
import { fallbackBrief } from '../brief';
import { createDesignContract, designContractPrompt } from '../design-contract';
import { auditDesignQuality, designFeedbackPrompt } from '../design-quality';
import type { GeneratedFile } from '../parse';

const website = fallbackBrief('Build a marketing website for Coffino coffee shop');
const page = (content: string): GeneratedFile => ({ path: 'src/app/page.tsx', content, language: 'tsx' });

describe('design contract', () => {
  it('requires a complete first viewport and representative preview content', () => {
    const prompt = designContractPrompt(createDesignContract(website)).toLowerCase();

    expect(prompt).toContain('first viewport');
    expect(prompt).toContain('realistic representative content');
    expect(prompt).toContain('no products');
    expect(prompt).toContain('primary action');
  });

  it('carries the strategist conversion decision into design review', () => {
    const prompt = designContractPrompt(
      createDesignContract(website, {
        conventions: [],
        competitorPatterns: [],
        differentiators: [],
        pages: [{ path: '/', name: 'Home', purpose: 'Convert', sections: ['Hero'] }],
        theme: { mood: 'warm', palette: 'earthy', typography: 'editorial', imagery: 'craft' },
        conversion: {
          primaryAction: 'Book a table',
          supportingActions: ['View menu'],
          proof: ['Open kitchen'],
        },
      }),
    );

    expect(prompt).toContain('Book a table');
    expect(prompt).toContain('Open kitchen');
  });
});

describe('design quality critic', () => {
  it('rejects the blank marketing shape shown in the preview', () => {
    const issues = auditDesignQuality(
      website,
      [page('export default function Page(){return <main><nav>Coffino</nav><section className="min-h-screen" /></main>}')],
    );

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['missing-primary-heading', 'missing-primary-action', 'no-visual-media']),
    );
  });

  it('rejects raw product and testimonial empty states on a public site', () => {
    const issues = auditDesignQuality(
      website,
      [page('<main><h1>Coffino</h1><p>No featured products yet</p><p>No testimonials yet</p><a href="/shop">Shop</a></main>')],
    );

    expect(issues.some((issue) => issue.code === 'raw-marketing-empty-state')).toBe(true);
  });

  it('accepts a composed marketing page with content, action and media', () => {
    const issues = auditDesignQuality(
      website,
      [page('<main><h1>Roasted for slow mornings</h1><img src="/coffee.jpg" alt="Coffee"/><a href="/shop">Choose a roast</a></main>')],
    );

    expect(issues).toEqual([]);
  });

  it('turns findings into explicit revision instructions', () => {
    const issues = auditDesignQuality(website, [page('<main />')]);
    const feedback = designFeedbackPrompt(issues);

    expect(feedback).toContain('[blocking] missing-primary-heading');
    expect(feedback).toContain('[blocking] missing-primary-action');
  });
});
