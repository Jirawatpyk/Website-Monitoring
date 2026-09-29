// The project's ESLint plugin `dxt` (registered in eslint.config.mjs).
import { noHardcodedDesignValues } from './design-tokens.mjs';
import { featureBoundaries } from './feature-boundaries.mjs';

export default {
  rules: {
    'feature-boundaries': featureBoundaries,
    'no-hardcoded-design-values': noHardcodedDesignValues,
  },
};
