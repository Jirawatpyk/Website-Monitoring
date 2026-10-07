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
});
