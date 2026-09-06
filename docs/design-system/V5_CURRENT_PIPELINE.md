# V5 Current Pipeline Audit

## Before this increment

The Build flow already had useful foundations: product classification, a persistent V4 Design DNA, model-generated files, compiler-owned CSS and `BrandImage`, deferred asset fulfillment, reusable preview sandboxes, source lint, one screenshot critique, and one bounded repair pass.

The failures visible in Coffino were architectural:

- combined products were flattened into one category (coffee shop + store became restaurant only);
- the model still made too many independent visual decisions after strategy;
- Design DNA was a prompt plus CSS, not a complete project recipe;
- component selection had no registry or usage ledger;
- assets were requested from prose without layout-aware composition data;
- visual QA saw one desktop viewport and could not establish responsive quality;
- source lint missed nested cards, unearned bento layouts, radius drift, and shadow drift;
- preview success could be mistaken for design approval even without enough evidence.

## V5 execution path

1. `understandProduct` preserves inferred Menu, Shop, and Location page needs.
2. `createDesignEngineV5` creates ProductSpec, BrandStrategy, three scored art directions, a selected direction, ReferenceAnalysis, storyboard, layout recipe, asset plan, routed skills, component choices, and a logical agent roster.
3. The deterministic compiler writes the design contract into `.reklu/*.json`, injects compiler CSS, and installs the safe media primitive.
4. The UI Builder receives V5 as an authoritative contract. It may implement content and behavior but may not silently choose a second design system.
5. Source lint rejects known structural and genericity failures before approval.
6. The background worker fulfills assets, captures 1440/1024/768/430/390 viewports, and makes one multi-viewport critic call.
7. One bounded same-provider repair is allowed. A regression restores the stronger checkpoint.
8. The quality gate stays pending unless the evidence it requires actually exists.

## Still intentionally pending

Full-page screenshot capture, decoded-image DOM assertions, keyboard/navigation automation, and measured contrast/overflow checks need additional browser instrumentation. V5 does not label those checks complete merely because a preview started.
