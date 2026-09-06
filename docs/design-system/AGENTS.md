# Logical Design Agents

| Agent | Mode | Output |
| --- | --- | --- |
| Product Interpreter | deterministic | ProductSpec and combined capabilities |
| Brand Director | structured model | positioning, voice, keywords, exclusions |
| Art Director | structured model | three directions and scored selection |
| Reference Analyst | structured model, when references exist | principles only; never copied code |
| Design System Guardian | deterministic | DesignDNA and token constraints |
| Layout Director | deterministic | storyboard, section rhythm, heading fit |
| Asset Director | deterministic | section-aware asset plan and fallback |
| Motion Director | deterministic | restrained motion and reduced-motion rules |
| UI Builder | structured model | complete implementation |
| Visual Critic | browser + vision | multi-viewport findings and scores |
| Design Fixer | structured model | one targeted repair |
| Accessibility/Responsive Auditor | browser | evidence for overflow, interaction, and accessibility gates |

Model-call count is deliberately smaller than role count. Deterministic roles run in-process; compatible structured roles share the authoritative V5 contract.
