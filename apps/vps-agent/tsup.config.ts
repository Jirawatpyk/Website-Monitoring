import { defineConfig } from 'tsup';

// Workspace packages (TypeScript source) and zod are bundled in; only Playwright stays external —
// it ships a browser, so /opt/dxt-agent installs it from deploy/package.json.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  noExternal: [/^@dxt\//, 'zod'],
  // A CommonJS dependency bundled into this ESM output (undici, via @dxt/probe, D-040) calls
  // `require('assert')` while loading; esbuild's stand-in throws without a real `require`, and the agent
  // died on start (security review, 13 Oct). `src/bundle.test.ts` starts the built bundle.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
