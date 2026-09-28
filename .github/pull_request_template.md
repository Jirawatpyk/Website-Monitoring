## What and why

<!-- One or two sentences. Link the board (docs/design/screens.md), FR or decision (docs/decisions.md). -->

## Checklist

- [ ] `pnpm check` passes
- [ ] Behaviour follows the design spec (later sections win) and any decision in `docs/decisions.md`
- [ ] Engine / rule changes have table-driven tests from the spec's examples
- [ ] New tables: RLS + explicit grants in the same migration; `pnpm db:types` committed
- [ ] New `/api/*` route: token check, zod-validated body, listed in `PUBLIC_PATHS` only if it must skip the session
- [ ] UI checked at 390 / 820 / 1440 px, light and dark; no dead controls
- [ ] No secrets, no spec sample data in product code
