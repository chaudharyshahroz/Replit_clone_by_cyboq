import type { ProductDesignContext } from './schemas';

export interface InformationArchitectureSection { readonly id: string; readonly purpose: string; readonly patterns: readonly string[]; }

export function createInformationArchitecture(context: ProductDesignContext): readonly InformationArchitectureSection[] {
  switch (context.productType) {
    case 'restaurant': return [
      { id: 'arrival', purpose: 'Create appetite and establish place', patterns: ['editorial hero', 'reservation action'] },
      { id: 'menu', purpose: 'Show signature food and price expectations', patterns: ['menu chapters', 'dish stories'] },
      { id: 'visit', purpose: 'Make a visit easy', patterns: ['hours and location', 'reservation'] },
    ];
    case 'developer_tool': return [
      { id: 'value', purpose: 'State the technical advantage', patterns: ['split hero', 'working code example'] },
      { id: 'first-success', purpose: 'Show the shortest path to value', patterns: ['quickstart steps', 'live response'] },
      { id: 'confidence', purpose: 'Prove reliability and fit', patterns: ['API capabilities', 'documentation routes', 'status evidence'] },
    ];
    case 'commerce': return [
      { id: 'discovery', purpose: 'Expose the product point of view', patterns: ['collection story', 'featured products'] },
      { id: 'merchandise', purpose: 'Support comparison and selection', patterns: ['product grid', 'category navigation'] },
      { id: 'confidence', purpose: 'Remove purchase risk', patterns: ['delivery', 'returns', 'reviews'] },
    ];
    default: return [
      { id: 'promise', purpose: context.primaryGoal, patterns: ['specific opening', 'primary action'] },
      { id: 'evidence', purpose: 'Make the promise tangible', patterns: ['product demonstration', 'proof'] },
      { id: 'decision', purpose: `Lead to ${context.conversionGoal}`, patterns: ['objection handling', 'focused CTA'] },
    ];
  }
}
