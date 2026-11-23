// Run with `node --test scripts/` (part of `pnpm test`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RuleTester } from 'eslint';
import { knownAuraTokenClasses, tokensFrom, unknownTokenClass } from './aura-token-classes.mjs';

const css = `
  --color-bg-surface: x; --color-bg-canvas: x; --color-fg-secondary: x; --color-border-subtle: x;
  --color-alert-warning-fg: x; --color-aura-brand: x;
  --spacing-aura-2: 8px; --spacing-aura-4: 16px;
  --radius-aura-md: 6px; --shadow-aura-overlay: x; --ease-aura-ease: x;
  @utility z-aura-dialog { z-index: 1 }
  @utility duration-aura-fast { transition-duration: 1ms }
`;
const t = tokensFrom(css);
const bad = (s) => unknownTokenClass(s, t);

test('unknownTokenClass', () => {
  // known tokens, the plain Tailwind scale and non-token names pass
  for (const ok of [
    'bg-bg-surface text-fg-secondary border-border-subtle',
    'hover:bg-bg-canvas md:p-aura-4 -mt-aura-2 gap-aura-2 !px-aura-4',
    'rounded-aura-md shadow-aura-overlay ease-aura-ease z-aura-dialog duration-aura-fast',
    'text-alert-warning-fg bg-aura-brand/50',
    'text-sm border-2 bg-transparent text-center p-4 gap-2 rounded-full shadow-md',
    'bg-[var(--aura-bg-surface)] grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
  ])
    assert.equal(bad(ok), null, ok);
  // the S17 PR 3a mistakes and their kind
  assert.equal(bad('p-4 bg-bg-subtle'), 'bg-bg-subtle');
  assert.equal(bad('xl:text-fg-muted'), 'xl:text-fg-muted');
  assert.equal(bad('scroll-mt-aura-7'), 'scroll-mt-aura-7');
  assert.equal(bad('rounded-aura-huge'), 'rounded-aura-huge');
  assert.equal(bad('shadow-aura-soft'), 'shadow-aura-soft');
  assert.equal(bad('border-border-faint'), 'border-border-faint');
});

test('reads the installed AURA theme', () => {
  // the real file: the tokens this repo uses everywhere exist, the S17 one doesn't
  assert.equal(unknownTokenClass('bg-bg-surface text-fg-secondary p-aura-4 rounded-aura-md'), null);
  assert.equal(unknownTokenClass('bg-bg-subtle'), 'bg-bg-subtle');
});

test('rule', () => {
  const tester = new RuleTester({
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  });
  tester.run('known-aura-token-classes', knownAuraTokenClasses, {
    valid: ['<div className="bg-bg-surface p-aura-4" />', 'const c = `text-fg-secondary ${x}`;'],
    invalid: [
      { code: '<div className="bg-bg-subtle" />', errors: [{ messageId: 'unknown' }] },
      { code: 'const c = `p-2 ${x} rounded-aura-huge`;', errors: [{ messageId: 'unknown' }] },
    ],
  });
});
