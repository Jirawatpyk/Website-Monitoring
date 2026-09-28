import { defineConfig } from 'tsup';

// Workspace packages ship TypeScript source, so they are bundled in; npm dependencies stay external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  noExternal: [/^@dxt\//],
});
