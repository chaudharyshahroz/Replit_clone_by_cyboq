import type { ProductDesignContext } from './schemas';

export interface ProductInput {
  readonly product: string;
  readonly summary: string;
  readonly target: string;
  readonly userRoles?: readonly string[];
  readonly pages?: readonly {
    readonly name: string;
    readonly purpose: string;
  }[];
}

const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

export function understandProduct(input: ProductInput): ProductDesignContext {
  const text = `${input.product} ${input.summary}`.toLowerCase();
  const productType = has(text, /restaurant|caf[eé]|\bcoffe[eo]?\b|bakery|bistro|menu|reservation/)
    ? 'restaurant'
    : has(text, /fintech|bank|financ(?:e|ial)|invest|payment|insurance/)
      ? 'fintech'
      : has(text, /developer|api|sdk|devtool|documentation/)
        ? 'developer_tool'
        : has(text, /gym|fitness|athletic|training club|workout/)
          ? 'fitness'
          : has(text, /fashion|apparel|clothing|couture|streetwear/)
            ? 'fashion'
            : has(text, /shop|store|commerce|product catalog|checkout/)
              ? 'commerce'
              : has(text, /magazine|newsletter|publication|editorial|podcast|newsroom|blog/)
                ? 'content'
                : has(
                      text,
                      /salon|spa|barber|plumb(?:er|ing)|electrician|cleaning service|repair service|law firm|accounting firm/,
                    )
                  ? 'local_service'
                  : has(text, /agency|creative studio|design studio/)
                    ? 'agency'
                    : has(text, /health|clinic|medical|dental|patient/)
                      ? 'healthcare'
                      : input.target === 'dashboard'
                        ? 'dashboard'
                        : input.target === 'web_app' || input.target === 'mobile_app'
                          ? 'application'
                          : has(text, /portfolio|studio|creator|photographer/)
                            ? 'portfolio'
                            : has(text, /saas|software|platform|ai /)
                              ? 'saas'
                              : 'other';

  const profiles: Record<
    string,
    Omit<
      ProductDesignContext,
      | 'productType'
      | 'requiredPages'
      | 'userReferences'
      | 'competitorReferences'
      | 'existingBrand'
      | 'audience'
    >
  > = {
    restaurant: {
      industry: 'hospitality',
      primaryGoal: 'Turn appetite into a visit or reservation',
      primaryCTA: 'Reserve a table',
      secondaryGoals: ['Explore the menu', 'Find location and hours'],
      brandPersonality: ['sensory', 'welcoming', 'confident'],
      visualTone: ['editorial', 'photographic', 'warm'],
      informationDensity: 'balanced',
      trustRequirements: ['Current menu', 'Location', 'Opening hours'],
      conversionGoal: 'Reservation or visit',
      devicePriority: 'mobile',
    },
    fintech: {
      industry: 'financial technology',
      primaryGoal: 'Establish trust before asking for commitment',
      primaryCTA: 'Get started securely',
      secondaryGoals: ['Understand the product', 'Review safeguards'],
      brandPersonality: ['precise', 'credible', 'calm'],
      visualTone: ['structured', 'restrained', 'data-aware'],
      informationDensity: 'balanced',
      trustRequirements: ['Security evidence', 'Transparent terms', 'Customer proof'],
      conversionGoal: 'Qualified signup',
      devicePriority: 'balanced',
    },
    developer_tool: {
      industry: 'developer tools',
      primaryGoal: 'Show technical value and shorten time to first success',
      primaryCTA: 'Start building',
      secondaryGoals: ['Read documentation', 'Inspect code examples'],
      brandPersonality: ['technical', 'direct', 'capable'],
      visualTone: ['developer-focused', 'dense', 'precise'],
      informationDensity: 'high',
      trustRequirements: ['Working examples', 'Documentation', 'Reliability evidence'],
      conversionGoal: 'API or product adoption',
      devicePriority: 'desktop',
    },
    commerce: {
      industry: 'commerce',
      primaryGoal: 'Help people discover and confidently buy products',
      primaryCTA: 'Shop products',
      secondaryGoals: ['Browse categories', 'Understand delivery and returns'],
      brandPersonality: ['product-led', 'clear', 'desirable'],
      visualTone: ['merchandising-first', 'photographic', 'clean'],
      informationDensity: 'balanced',
      trustRequirements: ['Pricing', 'Delivery', 'Returns', 'Reviews'],
      conversionGoal: 'Purchase',
      devicePriority: 'mobile',
    },
    healthcare: {
      industry: 'healthcare',
      primaryGoal: 'Help patients find appropriate care with confidence',
      primaryCTA: 'Book an appointment',
      secondaryGoals: ['Understand services', 'Meet the care team'],
      brandPersonality: ['reassuring', 'clear', 'professional'],
      visualTone: ['calm', 'human', 'accessible'],
      informationDensity: 'balanced',
      trustRequirements: ['Credentials', 'Privacy', 'Contact details'],
      conversionGoal: 'Appointment',
      devicePriority: 'mobile',
    },
    fitness: {
      industry: 'performance fitness',
      primaryGoal: 'Turn the training philosophy into a credible membership decision',
      primaryCTA: 'Book a training session',
      secondaryGoals: ['Explore programs', 'Meet the coaches'],
      brandPersonality: ['disciplined', 'physical', 'focused'],
      visualTone: ['editorial', 'cinematic', 'precise'],
      informationDensity: 'balanced',
      trustRequirements: ['Coach authority', 'Facility evidence', 'Specific programs'],
      conversionGoal: 'Trial or membership',
      devicePriority: 'mobile',
    },
    fashion: {
      industry: 'fashion',
      primaryGoal: 'Make the label point of view desirable and shoppable',
      primaryCTA: 'Explore the collection',
      secondaryGoals: ['Understand the collection story', 'Find a piece'],
      brandPersonality: ['distinctive', 'assured', 'cultural'],
      visualTone: ['editorial', 'photographic', 'restrained'],
      informationDensity: 'low',
      trustRequirements: ['Material detail', 'Delivery', 'Returns'],
      conversionGoal: 'Product discovery or purchase',
      devicePriority: 'mobile',
    },
    agency: {
      industry: 'creative services',
      primaryGoal: 'Demonstrate a distinct practice through selected work',
      primaryCTA: 'Start a project',
      secondaryGoals: ['View selected work', 'Understand the practice'],
      brandPersonality: ['opinionated', 'capable', 'original'],
      visualTone: ['portfolio-led', 'typographic', 'composed'],
      informationDensity: 'balanced',
      trustRequirements: ['Real work', 'Named capabilities', 'Client outcomes'],
      conversionGoal: 'Qualified inquiry',
      devicePriority: 'balanced',
    },
    default: {
      industry: productType.replace('_', ' '),
      primaryGoal: 'Make the primary product value and next action obvious',
      primaryCTA: input.target === 'website' ? 'Get started' : 'Continue',
      secondaryGoals: ['Understand the product', 'Build trust'],
      brandPersonality: ['clear', 'confident', 'focused'],
      visualTone: ['intentional', 'modern', 'restrained'],
      informationDensity: input.target === 'dashboard' ? 'high' : 'balanced',
      trustRequirements: ['Specific proof', 'Clear expectations'],
      conversionGoal: input.target === 'website' ? 'Qualified conversion' : 'Task completion',
      devicePriority: 'balanced',
    },
  };
  const profile = profiles[productType] ?? profiles.default!;
  const inferredPages = [
    { name: 'Home', purpose: profile.primaryGoal },
    ...(has(text, /menu|restaurant|caf[eé]|coffee shop|bakery|bistro/)
      ? [{ name: 'Menu', purpose: 'Show the current food and drink offer' }]
      : []),
    ...(has(text, /shop|store|commerce|product catalog|checkout|online (?:bean|coffee|merch)/)
      ? [{ name: 'Shop', purpose: 'Let customers browse and buy products' }]
      : []),
    ...(has(text, /location|find us|visit|restaurant|caf[eé]|coffee shop/)
      ? [{ name: 'Locations', purpose: 'Show addresses, hours, and visit details' }]
      : []),
  ].filter((page, index, pages) => pages.findIndex((candidate) => candidate.name === page.name) === index);

  return {
    productType,
    ...profile,
    audience: input.userRoles?.length ? [...input.userRoles] : ['Prospective users'],
    requiredPages: input.pages?.length
      ? [...input.pages]
      : inferredPages,
    userReferences: [],
    competitorReferences: [],
    existingBrand: false,
    identitySeed: input.product,
  };
}
