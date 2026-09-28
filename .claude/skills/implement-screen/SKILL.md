---
name: implement-screen
description: Build one DxT Monitor canvas board as a working Next.js route with AURA components, following docs/design/screens.md and the design spec. Use when asked to implement, build or update a screen/page/board (e.g. "/implement-screen Incident").
argument-hint: <BoardName>
---

# Implement screen: $ARGUMENTS

1. **Locate.** Find `$ARGUMENTS` in `docs/design/screens.md` → route, phase, slice, spec sections, PRD FRs. Screens are built inside their slice: if no `/slice` is in progress for that slice, or its dependencies aren't Done in `docs/implementation-plan.md`, say so and confirm before building. If it's a "Not a route" board, implement it in the package named there instead.
2. **Read the sources.**
   - `docs/design/canvas/$ARGUMENTS.dc.html` — layout, exact copy, every state in `renderVals()`, which `Aura.<Component>` sits where. The matching mobile board too (M-prefix), since the route is responsive.
   - Every spec section listed, plus §11, §13, §14.15–17. Later sections win.
   - The PRD FR rows for scope and data fields.
   - AURA component cards you'll use (AURA artifact `project/api/components/<Name>.md`) or the types in `node_modules/@jirawatpyk/aura-react`.
3. **Plan briefly** (in your reply, not a file): data needed and where it comes from (table/view, RLS as the user), components, client vs server split, states. If data or a table doesn't exist yet, note it — add a migration via `/new-migration` or use a typed loader returning placeholder-free empty data; never hard-code spec sample data.
4. **Build.**
   - Page in `apps/web/src/app/(app)/<route>/page.tsx` as a Server Component; interactive parts in small `'use client'` files beside it; reusable pieces in `apps/web/src/components/<area>/`.
   - Domain rules come from `@dxt/engine`; formatting from `@dxt/shared` (`formatDay`, `formatTime`, `formatDuration`, `formatPercent`, `TRIGGER_LABELS`). Add a helper there (with a test) rather than formatting inline.
   - Server Actions for mutations: validate with zod, check role, write `audit_log`, hold notifications 10 s for ack/resolve.
   - Eyebrow, title, meta line per §14.15; one primary button; confirms for destructive actions; loading/empty/no-access states.
5. **Verify.** `pnpm check`. Run `pnpm dev` and look at the route in the preview browser at 390, 820 and 1440 px, light and dark. Then run the `spec-checker` agent on the board and fix what it finds. When the slice is complete, flip the page's nav item to `live: true` in `apps/web/src/components/app-shell/nav.tsx`.
6. **Report** what was built, what's stubbed or waiting on data, and anything in the spec that was ambiguous.
