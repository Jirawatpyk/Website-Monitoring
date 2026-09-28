// Points git at the repository's hooks (.githooks) — run by `pnpm install` through `prepare`.
// Does nothing in CI or when there is no git checkout (e.g. a Vercel build).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!process.env.CI && existsSync('.git')) {
  try {
    execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { stdio: 'ignore' });
  } catch {
    // git missing: nothing to install.
  }
}
