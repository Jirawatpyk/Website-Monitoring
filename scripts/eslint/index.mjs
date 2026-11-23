// The project's ESLint plugin `dxt` (registered in eslint.config.mjs).
import { knownAuraTokenClasses } from './aura-token-classes.mjs';
import { noHardcodedDesignValues } from './design-tokens.mjs';
import { featureBoundaries } from './feature-boundaries.mjs';

export default {
  rules: {
    'feature-boundaries': featureBoundaries,
    'known-aura-token-classes': knownAuraTokenClasses,
    'no-hardcoded-design-values': noHardcodedDesignValues,
  },
};
