// Run with `node --test "scripts/**/*.test.mjs"` (part of `pnpm test`).
import { test } from 'node:test';
import { RuleTester } from 'eslint';
import { noHardcodedDesignValues } from './design-tokens.mjs';

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const cls = (className) => `const x = <div className="${className}" />;`;

test('no-hardcoded-design-values', () => {
  tester.run('no-hardcoded-design-values', noHardcodedDesignValues, {
    valid: [
      // Tailwind scale and AURA utilities.
      cls('flex gap-2 px-4 py-8 text-sm rounded-aura-md shadow-aura-overlay p-aura-4'),
      // Brackets without a literal length or colour.
      cls('grid-cols-[minmax(0,1fr)_auto] data-[state=open]:bg-bg-surface [&>svg]:size-4'),
      cls('p-[var(--aura-space-4)] w-[calc(100%-var(--aura-space-8))]'),
      // Class lists built with helpers.
      "const c = cn('gap-2', active && 'bg-bg-surface');",
      // Styles from tokens, unitless numbers, zero.
      "const x = <div style={{ background: 'var(--aura-bg-surface-strong)', borderRadius: 'var(--aura-radius-sm)' }} />;",
      'const x = <div style={{ flexGrow: 1, opacity: 0.5, margin: 0 }} />;',
      // Plain strings that happen to hold numbers.
      "const label = 'Checked every 1 min';",
    ],
    invalid: [
      { code: cls('p-[13px]'), errors: [{ messageId: 'className' }] },
      { code: cls('w-[350px] flex'), errors: [{ messageId: 'className' }] },
      { code: cls('text-[0.9rem]'), errors: [{ messageId: 'className' }] },
      { code: cls('bg-[#fafafa]'), errors: [{ messageId: 'className' }] },
      { code: cls('shadow-[0_1px_2px_rgba(0,0,0,0.1)]'), errors: [{ messageId: 'className' }] },
      { code: cls('hover:z-[99]'), errors: [{ messageId: 'className' }] },
      { code: cls('[margin:12px]'), errors: [{ messageId: 'className' }] },
      { code: "const c = cn('gap-2', 'mt-[7px]');", errors: [{ messageId: 'className' }] },
      { code: 'const c = `px-4 h-[72px]`;', errors: [{ messageId: 'className' }] },
      { code: 'const x = <div style={{ padding: 12 }} />;', errors: [{ messageId: 'style' }] },
      { code: "const x = <div style={{ marginTop: '8px' }} />;", errors: [{ messageId: 'style' }] },
      { code: "const x = <div style={{ color: '#111' }} />;", errors: [{ messageId: 'style' }] },
      { code: 'const x = <div style={{ zIndex: 10 }} />;', errors: [{ messageId: 'style' }] },
      {
        code: "const x = <div style={{ boxShadow: '0 1px 2px rgba(0,0,0,.1)', gap: 4 }} />;",
        errors: [{ messageId: 'style' }, { messageId: 'style' }],
      },
    ],
  });
});
