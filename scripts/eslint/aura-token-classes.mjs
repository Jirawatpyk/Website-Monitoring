// ESLint rule dxt/known-aura-token-classes — a class that looks like an AURA token must name one that
// exists, or Tailwind silently emits nothing (S17 PR 3a wrote `bg-bg-subtle` and `scroll-mt-aura-4`;
// Profile kept a dead `bg-bg-subtle`). The names come from the installed @jirawatpyk/aura-tokens
// Tailwind theme (`--color-*`, `--spacing-aura-*`, `--radius-aura-*`, `--shadow-aura-*`, `--ease-*`, and
// its `@utility` names), so an AURA upgrade that adds or drops a token changes the rule with it.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const WEB = path.resolve(import.meta.dirname, '../../apps/web/package.json');

/** The token names AURA's Tailwind theme defines, read from its CSS. Exported for tests. */
export function tokensFrom(css) {
  const vars = (prefix) =>
    new Set([...css.matchAll(new RegExp(`--${prefix}-([a-z0-9-]+)\\s*:`, 'g'))].map((m) => m[1]));
  const colors = vars('color');
  return {
    colors,
    // the first part of each colour name: bg, fg, border, alert, status, focus, accent, chart, aura
    colorSpaces: new Set([...colors].map((c) => c.split('-')[0])),
    spacing: vars('spacing'),
    radius: vars('radius'),
    shadow: vars('shadow'),
    ease: vars('ease'),
    utilities: new Set([...css.matchAll(/@utility\s+([a-z0-9-]+)/g)].map((m) => m[1])),
  };
}

let cached = null;
function installedTokens() {
  if (!cached) {
    const file = createRequire(WEB).resolve('@jirawatpyk/aura-tokens/tailwind.css');
    cached = tokensFrom(fs.readFileSync(file, 'utf8'));
  }
  return cached;
}

// Tailwind utilities that take a colour name.
const COLOR_UTIL =
  /^(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|divide|from|via|to|decoration|accent|caret|placeholder|shadow|inset-shadow)-(.+)$/;
// `<utility>-aura-<name>`: a radius, a shadow, an ease or a spacing step. Only Tailwind utilities are
// read — `data-aura-tip` or a `--aura-chart-1` string is no class.
const AURA_SCALE =
  /^(-?)(rounded(?:-[a-z]{1,2})?|shadow|ease|p[xytrblse]?|m[xytrblse]?|gap(?:-[xy])?|space-[xy]|w|h|size|min-[wh]|max-[wh]|inset(?:-[xy])?|top|right|bottom|left|start|end|scroll-[mp][xytrblse]?|translate-[xy]|basis|indent)-(aura-[a-z0-9-]+)$/;

/** The unknown AURA-looking class in a class list, or null. Exported for tests. */
export function unknownTokenClass(value, tokens = installedTokens()) {
  for (const raw of value.split(/\s+/)) {
    if (!raw || raw.includes('[') || raw.includes('$')) continue;
    const cls = raw
      .split(':')
      .pop()
      .replace(/^!/, '')
      .replace(/\/[\w.]+$/, '');
    if (tokens.utilities.has(cls)) continue;

    const aura = AURA_SCALE.exec(cls);
    if (aura) {
      const [, , util, name] = aura;
      const known =
        util === 'rounded' || util.startsWith('rounded-')
          ? tokens.radius.has(name)
          : util === 'shadow'
            ? tokens.shadow.has(name) || tokens.colors.has(name)
            : util === 'ease'
              ? tokens.ease.has(name)
              : COLOR_UTIL.test(cls) && tokens.colors.has(name)
                ? true
                : tokens.spacing.has(name);
      if (!known) return raw;
      continue;
    }

    const color = COLOR_UTIL.exec(cls);
    if (color) {
      const name = color[1];
      // only names in AURA's colour namespaces: text-sm, border-2 and bg-transparent aren't tokens
      if (tokens.colorSpaces.has(name.split('-')[0]) && !tokens.colors.has(name)) return raw;
    }
  }
  return null;
}

export const knownAuraTokenClasses = {
  meta: {
    type: 'problem',
    docs: { description: 'An AURA-looking class names a token that exists' },
    schema: [],
    messages: {
      unknown:
        '"{{token}}" isn’t an AURA token class — Tailwind emits nothing for it. Check the token name in @jirawatpyk/aura-tokens (docs/design/aura.md).',
    },
  },
  create(context) {
    const check = (node, value) => {
      const token = unknownTokenClass(value);
      if (token) context.report({ node, messageId: 'unknown', data: { token } });
    };
    return {
      Literal(node) {
        if (typeof node.value === 'string') check(node, node.value);
      },
      TemplateLiteral(node) {
        check(node, node.quasis.map((q) => q.value.cooked ?? '').join(' '));
      },
    };
  },
};
