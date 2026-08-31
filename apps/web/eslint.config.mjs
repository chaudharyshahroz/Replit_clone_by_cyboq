import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      // This app intentionally starts async actions and restores persisted UI
      // state from effects. These React Compiler opt-in rules reject those
      // established patterns even though React and Next support them.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      // Menu uses a stable render-prop callback stored in a ref so opening the
      // portal does not recreate its public API.
      'react-hooks/refs': 'off',
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
