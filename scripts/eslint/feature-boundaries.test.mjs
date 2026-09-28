// Run with `node --test scripts/` (part of `pnpm test`).
import path from 'node:path';
import { test } from 'node:test';
import { RuleTester } from 'eslint';
import { featureBoundaries } from './feature-boundaries.mjs';

const src = path.resolve(import.meta.dirname, '../../apps/web/src');
const file = (rel) => path.join(src, rel);

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
});

test('feature-boundaries', () => {
  tester.run('feature-boundaries', featureBoundaries, {
    valid: [
      // A route uses a feature through its public entries.
      {
        filename: file('app/(app)/incidents/page.tsx'),
        code: "import { IncidentList } from '@/features/incidents';",
      },
      {
        filename: file('app/(app)/incidents/page.tsx'),
        code: "import { loadIncidents } from '@/features/incidents/server';",
      },
      // A feature uses its own internals, relative or by alias.
      {
        filename: file('features/incidents/components/list.tsx'),
        code: "import { schema } from '../schemas';",
      },
      {
        filename: file('features/incidents/queries.ts'),
        code: "import { x } from '@/features/incidents/schemas';",
      },
      // A feature uses another feature's public entry, shared components and lib.
      {
        filename: file('features/incidents/components/card.tsx'),
        code: "import { SiteName } from '@/features/sites';",
      },
      {
        filename: file('features/incidents/queries.ts'),
        code: "import { createClient } from '@/lib/supabase/server';",
      },
      {
        filename: file('features/incidents/components/card.tsx'),
        code: "import { Brand } from '@/components/app-shell/brand';",
      },
      // Packages and files outside apps/web/src are not checked.
      { filename: file('features/incidents/queries.ts'), code: "import { canResolve } from '@dxt/engine';" },
      {
        filename: path.resolve(src, '../../../packages/engine/src/x.ts'),
        code: "import a from '../../apps/web/src/app/page';",
      },
    ],
    invalid: [
      {
        filename: file('app/(app)/incidents/page.tsx'),
        code: "import { List } from '@/features/incidents/components/list';",
        errors: [{ messageId: 'deepImport' }],
      },
      {
        filename: file('features/incidents/components/card.tsx'),
        code: "import { SiteRow } from '@/features/sites/components/site-row';",
        errors: [{ messageId: 'deepImport' }],
      },
      {
        filename: file('features/incidents/components/card.tsx'),
        code: "import { q } from '../../sites/queries';",
        errors: [{ messageId: 'deepImport' }],
      },
      {
        filename: file('features/incidents/components/card.tsx'),
        code: "export { q } from '@/features/sites/queries';",
        errors: [{ messageId: 'deepImport' }],
      },
      {
        filename: file('components/status-badge.tsx'),
        code: "import { x } from '@/features/incidents';",
        errors: [{ messageId: 'layer' }],
      },
      {
        filename: file('lib/audit.ts'),
        code: "import page from '@/app/(app)/page';",
        errors: [{ messageId: 'layer' }],
      },
      {
        filename: file('features/incidents/actions.ts'),
        code: "const m = import('@/app/(app)/layout');",
        errors: [{ messageId: 'layer' }],
      },
    ],
  });
});
