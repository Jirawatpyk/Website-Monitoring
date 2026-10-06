# AURA in DxT Monitor

AURA is the only UI kit. Its full docs live in the [AURA design system](https://claude.ai/artifact/X85Noq8acCgW1oryP1vwZq) (component cards under `project/api/components/<Name>.md`) and the [Storybook](https://jirawatpyk.github.io/Aura-design/). This page records how this project uses it.

## Packages

- `@jirawatpyk/aura-react` and `@jirawatpyk/aura-tokens`, pinned `^5.31.0` in `apps/web` (tokens also at the root for the ESLint plugin). Both always share one version.
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

1. DataTable columns with fixed widths can overflow narrow containers (~550 px) — give one column flex, or use `stackBelow` / `hideBelow`.
2. Dialog initial focus lands on the close button — set focus to the first field or the title.
3. SideNav item `badge` has no tone of its own — pass a `<Badge tone="danger">Fault</Badge>` element (documented in AURA); `count` stays neutral.
4. Switch disabled + checked looks like off — for "always on" settings show Badge "Always on" instead (Security board does this).

Report new gaps to the AURA repo (github.com/Jirawatpyk/Aura-design); build project-specific components in `apps/web/src/components`, not in AURA.

## Requests to AURA

Tracked in the Claude Doc [AURA feature requests — from DxT Monitor](https://claude.ai/code/artifact/b1691a29-0ad9-420e-b26b-966c4ad86aac) (6 Oct 2026). All four shipped in **AURA 5.32** and DxT's workarounds are gone:

- SideNav header divider → `SideNav headerDivider` (`components/app-shell/app-nav.tsx`).
- IconButton tooltip → AURA's own tip (hover and keyboard focus); don't wrap IconButtons in `<Tooltip>`, and find them in tests by accessible name, not `title`.
- PageHeader → AURA `PageHeader` (no outer padding: AppShell's content padding is the page margin).
- Skeleton pill → `Skeleton variant="pill"` (StatusPill size) or `variant="badge"` (Badge size).

Open (7 Oct 2026):

- **IconButton hover on SideNav.** The hover background is the same colour as the SideNav surface (both `rgb(250, 250, 250)` in light), so hovering an IconButton in the sidebar footer (Sign out) shows no change; only the tip and the pointer cursor do. Ask: an IconButton's hover is always visibly darker than the surface it sits on (or a SideNav variant). Until it ships, leave it — no local override (no hard-coded colours, and the tip already shows the button is live).
- **AppShell header on phones only.** With a `header`, AppShell shows its top bar at every width; only the phone boards draw one (D-018). DxT hides it from lg in `apps/web/src/app/globals.css` (`.dxt-shell-phone-bar`, also zeroing `--aura-shell-bar-height`), which reaches into AURA's class names. Ask: an AppShell option for a header shown only where the menu button shows (e.g. `headerHideFrom="lg"`), keeping the sticky offset right. Then drop the class and the CSS block.
- **PageHeader breadcrumb slot.** `eyebrow` renders a `<p>`, so AURA `Breadcrumb` (`<nav><ol>`) can't go in it without invalid HTML. DxT puts the Breadcrumb 4 px above a PageHeader with no eyebrow (D-018). Ask: a `breadcrumb` slot (or `eyebrow` as a `<div>`), spaced like the eyebrow. Then move the Breadcrumb into it.
- **SideNav header in the phone drawer = bar height.** Below lg, with `headerDivider`, the drawer's header is 72 px (the desktop board's), so its line sits 16 px below the AppShell bar's line (56 px) beside it — measured at 390 px, light and dark. No board draws the drawer. Ask: inside AppShell's phone drawer, the SideNav header takes `--aura-shell-bar-height` so the two lines meet; the desktop sidebar keeps 72 px. No DxT workaround.
