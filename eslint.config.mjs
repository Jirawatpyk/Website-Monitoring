// ESLint 9 flat config for the whole monorepo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import aura from '@jirawatpyk/aura-tokens/eslint-plugin';
import dxt from './scripts/eslint/index.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'docs/**',
      'packages/db/src/database.types.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    },
  },
  // Web app: Next.js + React hooks + AURA (no hard-coded colours).
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
    },
  },
  { files: ['apps/web/**/*.{ts,tsx}'], ...aura.configs.recommended },
  // Folder structure: features reached only through their public entry; layers point one way.
  // Design values: spacing, sizes, radii, shadows, z-index and colours only from AURA tokens.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { dxt },
    rules: {
      'dxt/feature-boundaries': 'error',
      'dxt/no-hardcoded-design-values': 'error',
      // Icons as components from @jirawatpyk/aura-react/icons (AURA 6.0 drops the string map;
      // docs/design/aura.md). S02b slipped string names past review.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='icon'][value.type='Literal']",
          message:
            'Pass an icon component (`icon={<IconCheck />}` from @jirawatpyk/aura-react/icons), not a name.',
        },
        {
          selector: "JSXOpeningElement[name.name='Icon']",
          message:
            'Use the icon component itself (`<IconCheck />` from @jirawatpyk/aura-react/icons), not <Icon name>.',
        },
      ],
    },
  },
  // D-029: whether a check is a hard-fail vote is decided once, by isHardFail (packages/engine/src/
  // hard-fail.ts) — a certificate-chain error is no outage, and uptime / reports must not count it.
  {
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator=/^[!=]==?$/] > Literal[value='fail']",
          message: "Use isHardFail(check) from './hard-fail' (D-029), not outcome === 'fail'.",
        },
      ],
    },
  },
  // Pages render without the cron / ingest secrets (the CI e2e job has none): read the few values a
  // page shows through their own helpers, not serverEnv(), which refuses to run without every secret
  // (S05 CI failure, docs/retro.md).
  {
    files: ['apps/web/src/app/**/page.tsx', 'apps/web/src/app/**/layout.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/env',
              importNames: ['serverEnv'],
              message: 'A page must render without every server secret: add a small helper in lib/env.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.test.{ts,tsx}'],
    rules: { 'dxt/no-hardcoded-design-values': 'off' },
  },
  // Tests may use non-null assertions and loose fixtures.
  {
    files: ['**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
