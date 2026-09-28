// ESLint rule `dxt/feature-boundaries` for apps/web/src (structure: apps/web/CLAUDE.md → Folder structure).
//
// 1. Another feature is reached only through its public entry: `@/features/<name>` (index.ts, client-safe)
//    or `@/features/<name>/server` (server-only queries and actions). Deep imports into its folders fail.
// 2. Layers point one way: app → features → components / lib. `components/` and `lib/` never import
//    `features/` or `app/`; `features/` and `server/` never import `app/`.
import path from 'node:path';

const SRC_MARKER = `${path.sep}apps${path.sep}web${path.sep}src${path.sep}`;
const PUBLIC_ENTRIES = new Set(['', 'index', 'index.ts', 'index.tsx', 'server', 'server.ts']);

/** Path relative to apps/web/src with forward slashes, or null when the file is outside it. */
function srcRelative(absolute) {
  const normalized = path.normalize(absolute);
  const at = normalized.lastIndexOf(SRC_MARKER);
  if (at < 0) return null;
  return normalized
    .slice(at + SRC_MARKER.length)
    .split(path.sep)
    .join('/');
}

function resolveSpecifier(specifier, filename) {
  const srcRoot = filename.slice(0, path.normalize(filename).lastIndexOf(SRC_MARKER) + SRC_MARKER.length);
  if (specifier.startsWith('@/')) return srcRelative(path.join(srcRoot, specifier.slice(2)));
  if (specifier.startsWith('.')) return srcRelative(path.resolve(path.dirname(filename), specifier));
  return null; // packages
}

const layerOf = (rel) => rel.split('/')[0];
const featureOf = (rel) => (rel.startsWith('features/') ? rel.split('/')[1] : null);

export const featureBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep features isolated and layers one-way in apps/web/src' },
    messages: {
      deepImport:
        "Import feature '{{feature}}' through its public entry ('@/features/{{feature}}' or '@/features/{{feature}}/server'), not '{{specifier}}'.",
      layer:
        "'{{from}}/' must not import from '{{to}}/' — dependencies point app → features → components / lib.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.filename;
    const fromRel = srcRelative(filename);
    if (!fromRel) return {};
    const fromLayer = layerOf(fromRel);
    const fromFeature = featureOf(fromRel);

    function check(node, specifier) {
      if (typeof specifier !== 'string') return;
      const toRel = resolveSpecifier(specifier, filename);
      if (!toRel) return;
      const toLayer = layerOf(toRel);

      const forbiddenLayer =
        (['components', 'lib'].includes(fromLayer) && ['features', 'app'].includes(toLayer)) ||
        (['features', 'server'].includes(fromLayer) && toLayer === 'app');
      if (forbiddenLayer) {
        context.report({ node, messageId: 'layer', data: { from: fromLayer, to: toLayer } });
        return;
      }

      const toFeature = featureOf(toRel);
      if (!toFeature || toFeature === fromFeature) return;
      const inside = toRel.split('/').slice(2).join('/');
      if (!PUBLIC_ENTRIES.has(inside)) {
        context.report({ node, messageId: 'deepImport', data: { feature: toFeature, specifier } });
      }
    }

    return {
      ImportDeclaration: (node) => check(node.source, node.source.value),
      ExportNamedDeclaration: (node) => node.source && check(node.source, node.source.value),
      ExportAllDeclaration: (node) => check(node.source, node.source.value),
      ImportExpression: (node) => node.source.type === 'Literal' && check(node.source, node.source.value),
    };
  },
};
