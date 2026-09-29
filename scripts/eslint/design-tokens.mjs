// ESLint rule dxt/no-hardcoded-design-values — spacing, sizes, radii, shadows, z-index and colours
// come from AURA tokens, never literals (docs/design/aura.md → Tokens). The AURA plugin already
// catches raw colour classes; this rule covers what it doesn't:
//   - Tailwind arbitrary values with a literal length or colour: p-[13px], w-[350px], text-[15px],
//     rounded-[6px], bg-[#fff], shadow-[0_1px_2px_rgba(0,0,0,.1)], z-[99]
//   - inline `style={{ … }}` with a literal length or colour: padding: 12, margin: '8px', color: '#111'
// Allowed: the Tailwind scale (p-4, gap-2 — the same 4 px grid as AURA), AURA utilities (p-aura-4,
// rounded-aura-md, shadow-aura-overlay), and var(--aura-…) inside brackets or styles. A genuine
// exception gets `// eslint-disable-next-line dxt/no-hardcoded-design-values -- <why>`.

const LENGTH = /(?:^|[^\w-])-?\d*\.?\d+(?:px|rem|em|vh|vw|dvh|svh|lvh|pt|ch)\b/i;
const COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color-mix)\(/i;
const BRACKETS = /\[([^\]]*)\]/g;
const Z_ARBITRARY = /(?:^|:)-?z-\[\d/;
// React turns a bare number into px for these properties (zIndex: a raw layer instead of --aura-z-*).
const NUMERIC_LENGTH_PROP =
  /^(?:width|height|(?:min|max)(?:Width|Height)|margin\w*|padding\w*|gap|rowGap|columnGap|top|right|bottom|left|inset\w*|fontSize|letterSpacing|flexBasis|border\w*(?:Width|Radius)|borderRadius|outline(?:Width|Offset)|zIndex)$/;

/** Why a class-list string breaks the rule, or null. Exported for tests. */
export function classViolation(value) {
  for (const token of value.split(/\s+/)) {
    if (!token.includes('[')) continue;
    if (Z_ARBITRARY.test(token)) return { token, kind: 'z-index' };
    for (const [, inner] of token.matchAll(BRACKETS)) {
      const css = inner.replaceAll('_', ' ');
      if (COLOR.test(css)) return { token, kind: 'colour' };
      if (LENGTH.test(css)) return { token, kind: 'length' };
    }
  }
  return null;
}

/** Why a style value breaks the rule, or null. Exported for tests. */
export function styleViolation(prop, value) {
  if (typeof value === 'number') {
    return value !== 0 && NUMERIC_LENGTH_PROP.test(prop) ? (prop === 'zIndex' ? 'z-index' : 'length') : null;
  }
  if (typeof value !== 'string') return null;
  if (COLOR.test(value)) return 'colour';
  if (LENGTH.test(value)) return 'length';
  return null;
}

const staticString = (node) => {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral') return node.quasis.map((q) => q.value.cooked ?? '').join(' ');
  return null;
};

export const noHardcodedDesignValues = {
  meta: {
    type: 'problem',
    docs: { description: 'Spacing, sizes, radii, shadows, z-index and colours come from AURA tokens' },
    schema: [],
    messages: {
      className:
        'Hard-coded {{kind}} in "{{token}}" — use an AURA token (p-aura-4, rounded-aura-md, shadow-aura-overlay, bg-bg-surface) or the Tailwind scale.',
      style: 'Hard-coded {{kind}} in style.{{prop}} — use var(--aura-…) or an AURA utility class instead.',
    },
  },
  create(context) {
    const checkString = (node, value) => {
      const hit = classViolation(value);
      if (hit) context.report({ node, messageId: 'className', data: hit });
    };

    return {
      Literal(node) {
        if (typeof node.value === 'string') checkString(node, node.value);
      },
      TemplateLiteral(node) {
        checkString(node, node.quasis.map((q) => q.value.cooked ?? '').join(' '));
      },
      JSXAttribute(node) {
        if (node.name.name !== 'style' || node.value?.type !== 'JSXExpressionContainer') return;
        const object = node.value.expression;
        if (object.type !== 'ObjectExpression') return;
        for (const property of object.properties) {
          if (property.type !== 'Property' || property.computed) continue;
          const prop = property.key.type === 'Identifier' ? property.key.name : String(property.key.value);
          const literal =
            property.value.type === 'Literal' ? property.value.value : staticString(property.value);
          const kind = styleViolation(prop, literal);
          if (kind) context.report({ node: property.value, messageId: 'style', data: { kind, prop } });
        }
      },
    };
  },
};
