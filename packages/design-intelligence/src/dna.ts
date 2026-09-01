import type { DesignDNA, ProductDesignContext } from './schemas';

const BASE = {
  version: 1 as const,
  spacing: [4, 8, 12, 16, 24, 32, 48, 64, 96],
  shadows: { subtle: '0 1px 2px rgb(15 23 42 / 0.08)', elevated: '0 18px 50px rgb(15 23 42 / 0.14)' },
  borders: { width: 1, style: 'solid' },
  layoutGrid: { columns: 12, gutter: 24, margin: 24 },
  containerWidths: { content: 720, wide: 1200 },
  motion: { style: 'purposeful and subtle', durationMs: [150, 300] as [number, number] },
  accessibilityRules: ['WCAG AA text contrast', 'Visible keyboard focus', '44px touch targets', 'Respect reduced motion'],
  dontRules: ['No decorative gradients without a content role', 'No wall of identical cards', 'No emoji iconography', 'No giant heading that obscures the product'],
};

export function createDesignDNA(context: ProductDesignContext): DesignDNA {
  const restaurant = context.productType === 'restaurant';
  const developer = context.productType === 'developer_tool';
  const fintech = context.productType === 'fintech';
  const commerce = context.productType === 'commerce';
  const directionId = restaurant ? 'editorial-hospitality' : developer ? 'technical-workbench' : fintech ? 'precision-trust' : commerce ? 'product-first' : 'quiet-confidence';
  return {
    ...BASE,
    directionId,
    personality: context.brandPersonality,
    visualDirection: restaurant ? 'Editorial hospitality with immersive imagery and menu-like rhythm' : developer ? 'Technical workbench with code-forward evidence and compact navigation' : fintech ? 'Precision trust with restrained surfaces and clear data hierarchy' : commerce ? 'Product-first merchandising with strong imagery and decisive hierarchy' : 'Quiet confidence with one memorable subject-specific signature',
    typography: restaurant
      ? { display: 'Fraunces', body: 'Source Sans 3', mono: 'ui-monospace', displayWeight: 600, bodyWeight: 400, scale: [14, 16, 20, 28, 40, 64] }
      : developer ? { display: 'Space Grotesk', body: 'Inter', mono: 'IBM Plex Mono', displayWeight: 600, bodyWeight: 400, scale: [13, 15, 18, 24, 36, 56] }
        : { display: 'Manrope', body: 'Inter', mono: 'ui-monospace', displayWeight: 650, bodyWeight: 400, scale: [14, 16, 20, 28, 40, 60] },
    colors: restaurant
      ? { background: '#F4EFE7', surface: '#FFF9F0', surfaceRaised: '#FFFFFF', text: '#231A16', muted: '#75665D', border: '#D8CCBF', primary: '#8A3B24', onPrimary: '#FFFFFF', success: '#2F6B4F', warning: '#9A6415', danger: '#A3342F' }
      : developer ? { background: '#0B1017', surface: '#111A24', surfaceRaised: '#172331', text: '#EAF1F7', muted: '#93A4B5', border: '#2A3948', primary: '#62D9C6', onPrimary: '#071310', success: '#4ECB8D', warning: '#E6B85C', danger: '#F07178' }
        : fintech ? { background: '#F5F7F8', surface: '#FFFFFF', surfaceRaised: '#FFFFFF', text: '#13201C', muted: '#63706B', border: '#D8E0DD', primary: '#125A45', onPrimary: '#FFFFFF', success: '#217A55', warning: '#A06813', danger: '#B13A3A' }
          : { background: '#F7F6F3', surface: '#FFFFFF', surfaceRaised: '#FCFCFA', text: '#1D2523', muted: '#68716E', border: '#DDE1DF', primary: '#245C50', onPrimary: '#FFFFFF', success: '#277458', warning: '#9A6818', danger: '#B23A3A' },
    radius: developer ? { sm: 4, md: 8, lg: 12, pill: 999 } : restaurant ? { sm: 2, md: 6, lg: 12, pill: 999 } : { sm: 6, md: 10, lg: 16, pill: 999 },
    iconography: developer ? 'Crisp outlined technical symbols at consistent stroke weight' : 'Simple outlined symbols; photography carries emotional meaning',
    imageryStyle: restaurant ? 'Close, tactile, natural-light food and place photography' : commerce ? 'Consistent product crops with honest material detail' : 'Subject-specific editorial imagery, never abstract AI gradients',
    cardStyle: developer ? 'Dense bordered panels used only for discrete tools or examples' : 'Low-chrome groupings; cards only when content is independently actionable',
    buttonStyle: 'One dominant solid primary action, quiet secondary actions, explicit focus ring',
    inputStyle: 'Persistent labels, clear boundaries, helpful errors, no placeholder-only labeling',
    navigationStyle: restaurant ? 'Compact venue navigation with reservation action' : developer ? 'Documentation-aware navigation with product and developer paths' : 'Concise navigation organized around user intent',
    density: context.informationDensity,
    responsiveStrategy: context.devicePriority === 'mobile' ? 'Mobile-first; prioritize the conversion action and essential facts before imagery' : context.devicePriority === 'desktop' ? 'Desktop-efficient while preserving a complete single-column mobile task flow' : 'Content-led breakpoints with equal care at 390, 768, 1024 and 1440 widths',
    doRules: [`Optimize for: ${context.primaryGoal}`, `Make “${context.primaryCTA}” the dominant action`, `Use proof appropriate to ${context.industry}`],
  };
}

export function designDNAPrompt(dna: DesignDNA): string {
  return ['Persistent Design DNA — every page and component must use this same system:', JSON.stringify(dna, null, 2), 'Do not invent unrelated colors, fonts, radii, shadows, spacing, or component styles.'].join('\n');
}
