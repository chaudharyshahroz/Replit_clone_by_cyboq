# Visual Critic

The worker captures 1440, 1024, 768, 430, and 390 pixel-wide browser views and submits them together in one metered vision call. The critic scores brand fit, typography, color, composition, imagery, iconography, spacing, rhythm, originality, conversion clarity, and responsive coherence.

Critical defects override the score: irrelevant/broken media, horizontal overflow, clipped text, unreadable contrast, accidental one-word heading stacks, missing actions, unusable navigation, or desktop content merely squeezed onto mobile.

A pass requires an overall score of at least 82, every supplied viewport at least 82, and zero critical findings. The critic may trigger one same-provider targeted repair followed by re-review. If the revision regresses source lint or visual evidence, Reklu restores the previous checkpoint.
