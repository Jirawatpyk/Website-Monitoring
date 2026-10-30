# AURA in DxT Monitor

AURA is the only UI kit. Its full docs live in the [AURA design system](https://claude.ai/artifact/X85Noq8acCgW1oryP1vwZq) (component cards under `project/api/components/<Name>.md`) and the [Storybook](https://jirawatpyk.github.io/Aura-design/). This page records how this project uses it.

## Packages

- `@jirawatpyk/aura-react` and `@jirawatpyk/aura-tokens`, pinned `^5.36.0` in `apps/web` (tokens also at the root for the ESLint plugin). Both always share one version. After a bump, delete `apps/web/.next` and restart `pnpm dev`: Turbopack keeps serving the old AURA CSS from its cache (5.35: the new crumb and BottomNav rules looked missing).
- CSS is wired in two places — don't add more imports:
  - `apps/web/src/app/layout.tsx` imports `@jirawatpyk/aura-tokens/aura-fonts.local.css` (self-hosted fonts) and `./globals.css`, and renders `<ColorSchemeScript />` in `<head>`.
  - `apps/web/src/app/globals.css` declares `@layer theme, base, aura, components, utilities;`, then imports `tailwindcss`, `@jirawatpyk/aura-tokens/tailwind.css` (Tailwind v4 theme **and** `aura.css` tokens) and `@jirawatpyk/aura-react/styles.layer.css` (components inside `@layer aura`). The layer order lets Tailwind utilities override AURA component styles. Never also import `aura.css` or `styles.css` — that duplicates tokens and components outside the layers.
- `<AuraProvider locale="en" linkComponent={Link}>` in `apps/web/src/app/providers.tsx`. The product UI is English (PRD §9); no Thai locale pack.
- Tailwind class names map to AURA tokens (`bg-bg-surface`, `text-fg-secondary`, `border-border-default`, `font-display`, `font-mono`).
- ESLint: `@jirawatpyk/aura-tokens/eslint-plugin` (`aura.configs.recommended`) fails the lint on any hard-coded colour, and the project rule `dxt/no-hardcoded-design-values` (`scripts/eslint/design-tokens.mjs`) on Tailwind arbitrary values with a literal length or colour (`p-[13px]`, `bg-[#fff]`, `z-[99]`) and on literal lengths or colours in `style={{…}}`.
- Tokens to use instead: spacing `*-aura-0…16` (4 px grid; the Tailwind scale `p-1…p-16` is the same grid), radius `rounded-aura-xs…2xl|full`, shadow `shadow-aura-enterprise|overlay`, z-index `var(--aura-z-menu|dialog|bar|toast|tooltip)`, sizes `var(--aura-button-height)` etc. (`@jirawatpyk/aura-tokens/tokens.json`).
- Server Components: display components (Card, Badge, StatusPill, Alert, EmptyState, Icon) and helpers (`formatDate`, `statusTone`) come from `@jirawatpyk/aura-react/server`.

## Rules

- Use AURA components and semantic tokens as drawn. Never a raw hex, a Tailwind palette class (`bg-red-500`) or a hand-built control AURA already has.
  - Exception: alert emails (`packages/notifier/src/email-alerts.ts`). Email clients don't read CSS variables, so the AURA light tokens are resolved to hex in one constant there (aura-tokens 5.31); update it when the tokens change.
- Icons: import components from `@jirawatpyk/aura-react/icons` (`<IconBell />`), never icon names as strings — 6.0 drops the string map. Only the 70 AURA icons; a missing one comes from Lucide unchanged.
- Enterprise register everywhere in the app. Creative (mesh, grain, offset shadows) is not used in this product.
- Status badges follow spec §11 and §14.2: Down = Badge danger solid `ban`; Problem = Badge warning soft `triangle-alert`; OK = Badge success soft `circle-check`; Maintenance = Badge accent soft `calendar` — accent is reserved for Maintenance among status badges.
- Density: default comfortable; data-heavy tables may use `density="compact"`. Touch targets stay ≥ 44 px.
- Test every page at 390, 820 and 1440 px, light and dark.

## Icons available (70, unchanged through 5.31)

`activity` `arrow-down` `arrow-left` `arrow-right` `arrow-up` `arrow-up-down` `arrow-up-right` `ban` `bell` `calendar` `chart-column` `check` `chevron-down` `chevron-left` `chevron-right` `chevron-up` `circle` `circle-alert` `circle-check` `circle-dot-dashed` `clock` `cloud-upload` `columns-3` `copy` `download` `ellipsis` `external-link` `eye` `eye-off` `file` `file-text` `filter` `folder` `globe` `house` `image` `inbox` `info` `layout-dashboard` `loader-circle` `lock` `log-out` `mail` `menu` `minus` `monitor` `moon` `panel-left-close` `panel-left-open` `paperclip` `pencil` `phone` `pin` `pin-off` `plus` `rotate-ccw` `search` `server` `settings` `shield-alert` `sun` `trash-2` `trending-down` `trending-up` `triangle-alert` `upload` `user` `users` `wrench` `x`

## Useful since 5.10 (read the AURA README before building)

- **5.30:** text fields and choice rows are 44 px tall; menus stay open on scroll; tables show a scroll shadow and never squeeze a column below 10ch; neutral fills are visible on the light canvas.
- **5.26–5.29:** Table `stickyHeader`, `FilterDateRange`, `bleed` (edge-to-edge table inside a Card); Accordion / Combobox / Command read an item's description after its name (tests match the label alone plus `toHaveAccessibleDescription`).
- **5.21–5.25:** Table `rowHeight="density"` (rows the same height whatever the cell holds); toggle `Tag` `touchHeight` (44 px chips on touch).
- **5.31:** `labelAddon` on TextField / Textarea / PasswordField (e.g. the phrase to type in a typed confirmation, with a copy button).

## Known AURA gaps found during design

The canvas's orange note listed 14 issues. As of AURA 5.10 these are fixed (and since then a Tag's remove button is named from rich children, so `removeLabel` is no longer needed): StatusPill `warning` tone (5.1), Checkbox visible label (5.1, shown in 6.0), published `tokens.css`/`aura.css` with dark theme, README consuming section, fonts moved out of `bundle.css` (5.1), the six monitoring icons (5.1), SideNav top spacing and `bordered={false}` (5.1). Still check these before relying on them:

1. DataTable columns with fixed widths can overflow narrow containers (~550 px) — give one column flex, or use `stackBelow` / `hideBelow`. Since 5.51 a flexible column's `minWidth` counts in the row minimum (request 23); on 5.41 it counted as 160 px whatever it said.
2. Dialog initial focus lands on the close button — set focus to the first field or the title.
3. SideNav item `badge` has no tone of its own — pass a `<Badge tone="danger">Fault</Badge>` element (documented in AURA); `count` stays neutral.
4. Switch disabled + checked looks like off — for "always on" settings show Badge "Always on" instead (Security board does this).

Report new gaps to the AURA repo (github.com/Jirawatpyk/Aura-design); build project-specific components in `apps/web/src/components`, not in AURA.

## Requests to AURA

Tracked in the Claude Doc [AURA feature requests — from DxT Monitor](https://claude.ai/code/artifact/b1691a29-0ad9-420e-b26b-966c4ad86aac). Requests 1–23 have shipped (5.32–5.51). Open: request 24 (30 Oct 2026).

A new request goes in the doc (template at its foot) and here.

Open (stand-in in DxT until AURA ships):

- **Request 24 — BottomNav `hideOnScroll`: a tap leaves focus on the tab, so the bar never hides on the next page** (5.76, 30 Oct 2026).
  - AURA keeps the bar while focus is in it, which is right for a keyboard. But a tap on Chrome / Android also focuses the tab, and the BottomNav stays mounted across client-side navigation, so the bar stayed put on the new page however far you scrolled. Long pages like On-call showed it most.
  - **Stand-in:** `components/app-shell/phone-nav.tsx` wraps BottomNav in a `display: contents` div that blurs the tab on a pointer click (`event.detail > 0`). A keyboard's Enter is `detail` 0, so keyboard focus stays (test `phone-nav.test.tsx`).
  - Once shipped: drop the wrapper.

AURA 5.76 (from 5.41, 30 Oct 2026; DxT took it in `chore/aura-5.76`):

- **Request 23** (found on 5.41 in S10 B2c): DataTable counted every flexible column as 160 px in the row minimum, whatever its `minWidth`. It was already fixed in 5.51, which counts the column's own `minWidth`. The stand-in (flexing only a ~160 px column) is gone.
  - The On-call rotation table now flexes On call (`minWidth: 88`).
  - Alerts is fixed at 174 with `hideBelow: 730`.
  - Names still wrap with no avatar. Beside the swap card the column is only ~88–98 px, so an avatar would cut the names (D-048 12.28).
- **5.75: status pills are soft in every tone** (`variant="solid"` for the one status that must catch the eye).
  - DxT's site and incident statuses are Badges (unchanged).
  - The only StatusPill is Site detail's check outcome: "Fail" is now soft red. Its board gives a tone only, so AURA's default is kept.
- **5.75, dark theme:**
  - the selected fill is a violet wash;
  - the active SideNav item has a violet edge;
  - the table header band is a step above the card.
- **5.75:** plain links in a PageHeader, Popover or Drawer take the accent and an underline.
- Nothing else in 5.42–5.76 needed a DxT change (`tsc`, 1232 web tests and the e2e on the local stack). New props to reach for later:
  - DataTable `grow` and `keyboard="tab"`;
  - `linkClass()`, `Spinner`, `CheckboxGroup`;
  - PageHeader `actionsBar` / `actionsBarBelow`;
  - `fullWidth="below-sm"`;
  - `TableSkeleton`.

AURA 5.32 (requests 1–4, 6 Oct 2026):

- SideNav header divider → `SideNav headerDivider` (`components/app-shell/app-nav.tsx`).
- IconButton tooltip → AURA's own tip (hover and keyboard focus); don't wrap IconButtons in `<Tooltip>`, and find them in tests by accessible name, not `title`.
- PageHeader → AURA `PageHeader` (no outer padding: AppShell's content padding is the page margin).
- Skeleton pill → `Skeleton variant="pill"` (StatusPill size) or `variant="badge"` (Badge size).

AURA 5.33 (requests 5–8, 7 Oct 2026):

- Hover on the canvas → `--aura-bg-canvas-hover`: SideNav rows and buttons, PageHeader actions, Pagination and DataTable's header band now show hover. Hover fills read `--aura-hover`; outside AppShell, set `--aura-hover: var(--aura-bg-canvas-hover)` on your own canvas-coloured area. Nothing to change in DxT.
- Phone-only top bar → `AppShell headerHideFrom="lg"` (`app/(app)/layout.tsx`): the bar, header and all, shows only below 1024 px, and `--aura-shell-bar-height` is 0 from lg (D-018).
- Breadcrumb → `PageHeader breadcrumb={<Breadcrumb … />}`: its own `div` 4 px above the title, Breadcrumb keeps its 13 px sans; with an eyebrow too, the breadcrumb comes first (D-018). Never put a Breadcrumb in `eyebrow` (a `<p>`).
- Phone drawer header → takes the bar's measured height so the two lines meet; the drawer's close button is a 44 px target on touch. Nothing to change in DxT.

AURA 5.36 (requests 15–16, 10 Oct 2026; DxT took it in `chore/aura-5.36`):

- Request 15 — table cells clip their text, not the focus ring of a link or button in them (`overflow: clip` with a 4 px clip margin; rings drawn inside where Safari can't), and a ring in the first column sits above the sticky gutter → the `.aura-table__td` rules left `globals.css`.
- Request 16 — already in AURA (5.36 adds tests and docs): `DataTableColumn align: 'end'` right-aligns the header and cells with tabular figures; stacked cards keep values start-aligned → the Incidents Duration column.
- Side effect of 15: content wider than its cell (a pill, a button) can show up to 4 px into the next column.

AURA 5.37 (requests 17–18, 11 Oct 2026; DxT took it in `chore/aura-5.37`):

- Request 17 — `PageHeader actionsFullWidthBelow="md"`: below md the header actions take the row and share it in equal widths (three buttons wrap to two halves, then one across). Site detail, Edit site and Edit monitors pass it; the `max-md:[&>:last-child]:w-full` selector and Site detail's own grid are gone. Pass the buttons as direct children (a fragment): a wrapping `span` is one child and its buttons don't stretch. Edit monitors keeps its span (the "N unsaved changes" line sits in it).
- Request 18 — `SegmentedControl touchHeight` (44 px below 640 px or on a coarse pointer, as Button / TextField; `'always'` every width): the Maintenance dialog's Type, Start and Duration.
- Requests 19–22 — shipped in 5.41 (14 Oct 2026, D-045): `data-aura-hide-menubutton` (`PhoneBar`'s back link carries it, so a back-arrow page drops ☰); `PageHeader titleHideBelow="lg"` on every page whose title is in the phone bar (`components/phone-header.ts` keeps only the partial cases: Incident's breadcrumb, Maintenance's title, a Viewer's empty actions on Site detail); Menu items with `target="_blank"` read "… (opens in a new tab)"; a menu trigger keeps its hover fill while open (our `aria-expanded` class is gone).
- After an AURA upgrade restart `pnpm dev`: the running dev server kept 5.36's CSS (the new classes were in the markup, their rules missing).

AURA 5.35 (requests 11–14, 10 Oct 2026; DxT took it in `chore/aura-5.35`):

- Request 11 — crumb links get a 44 px tall touch area on coarse pointers, built in → the `.aura-crumbs a::after` rule left `globals.css`.
- Request 12 — `StatusTile status="unknown"` ("No data", circle-dot-dashed) → the Overview passes it for a site with no round yet, no `statusLabel` override.
- Request 13 — `AppShell headerHideOnScroll` → the phone top bar slides away scrolling down (`app/(app)/layout.tsx`).
- Request 14 — `BottomNav hideOnScroll` and `data-aura-hide-bottomnav` → `phone-nav.tsx` lost its scroll listener; the incident page's bar carries `data-aura-hide-bottomnav`; the `globals.css` BottomNav rules are gone.
- Not yet on a real iPhone (AURA's note): rubber-banding and the crumb touch areas in Safari still need a device check.

AURA 5.34 (S06b Overview, 9 Oct 2026):

- `StatusTile` + `TileGrid` → the Overview's All sites tiles (`columns={{ base: 2, xl: 3 }}`). Its icons are circle-alert (down) and wrench (maintenance), not the badges' ban and calendar; spec §21.10 accepts that (D-032). A title past two lines ends with "…" and shows in full in a tip.
- `Sparkline` → the Response 24h line in Live issues (`failures="none"`, `null` = no point, so the line breaks).
- All three are stateless and also exported from `/server`.
