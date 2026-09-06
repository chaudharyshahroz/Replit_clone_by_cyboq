import { describe, expect, it } from 'vitest';
import {
  createDesignEngineV5,
  DesignEngineV5Schema,
  routeDesignSkills,
  understandProduct,
} from '../index';

const examples = [
  ['Coffino', 'Neighbourhood coffee shop with reservations and an online bean shop'],
  ['Cipher', 'AI cybersecurity SaaS for engineering teams'],
  ['Forma', 'High energy fitness studio with memberships'],
  ['Vela', 'Independent fashion label and online store'],
  ['Orbit', 'Developer API platform with documentation and pricing'],
  ['Ledger', 'Financial analytics product for small businesses'],
  ['Mira', 'Editorial photography portfolio and enquiry site'],
  ['Northline', 'Local plumbing and emergency repair service'],
] as const;

describe('Design Intelligence V5', () => {
  it('turns Coffino into a complete, persistent design-team contract', () => {
    const context = understandProduct({
      product: 'Coffino',
      summary: 'Coffee shop with table reservations and an online coffee store',
      target: 'website',
    });
    const engine = createDesignEngineV5(context, 'coffino-regression');

    expect(DesignEngineV5Schema.parse(engine)).toEqual(engine);
    expect(engine.version).toBe(5);
    expect(engine.productSpec.commerce).toBe(true);
    expect(new Set(engine.artDirectionCandidates.map((item) => item.conceptName)).size).toBe(3);
    expect(engine.layoutRecipe).toMatchObject({ usabilityShare: 70, brandShare: 20, surpriseShare: 10 });
    expect(engine.assetPlan[0]).toMatchObject({ priority: 'critical', negativeSpace: 'left' });
    expect(engine.assetPlan[0]?.direction.length).toBeGreaterThan(30);
    expect(engine.activeAgents.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Product Interpreter', 'Art Director', 'Visual Critic', 'Design Fixer']),
    );
    expect(routeDesignSkills(context).map((item) => item.id)).toEqual(
      expect.arrayContaining(['hospitality-design', 'ecommerce-design', 'design-system-guardian']),
    );
  });

  it('is stable per project but avoids one universal visual treatment across industries', () => {
    const engines = examples.map(([product, summary], index) =>
      createDesignEngineV5(
        understandProduct({ product, summary, target: 'website' }),
        `v5-project-${index}`,
      ),
    );
    const signature = (index: number) => {
      const engine = engines[index]!;
      return [
        engine.compiler.engine.selection.profile,
        engine.compiler.engine.dna.typography.display,
        engine.compiler.engine.dna.colors.primary,
        engine.storyboard[0]?.composition,
        engine.activeSkills.map((item) => item.id).join(','),
      ].join('|');
    };

    expect(new Set(engines.map((_, index) => signature(index))).size).toBeGreaterThanOrEqual(7);
    const context = understandProduct({ product: examples[0][0], summary: examples[0][1], target: 'website' });
    expect(createDesignEngineV5(context, 'stable')).toEqual(createDesignEngineV5(context, 'stable'));
  });
});
