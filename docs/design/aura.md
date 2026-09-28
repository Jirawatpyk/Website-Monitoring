# AURA in DxT Monitor

AURA is the only UI kit. Its full docs live in the [AURA design system](https://claude.ai/artifact/X85Noq8acCgW1oryP1vwZq) (component cards under `project/api/components/<Name>.md`) and the [Storybook](https://jirawatpyk.github.io/Aura-design/). This page records how this project uses it.

## Packages

- `@jirawatpyk/aura-react` and `@jirawatpyk/aura-tokens`, pinned `^5.10.0` in `apps/web`. Both always share one version.
- CSS is wired in two places — don't add more imports:
  - `apps/web/src/app/layout.tsx` imports `@jirawatpyk/aura-tokens/aura-fonts.local.css` (self-hosted fonts) and `./globals.css`, and renders `<ColorSchemeScript />` in `<head>`.
  - `apps/web/src/app/globals.css` declares `@layer theme, base, aura, components, utilities;`, then imports `tailwindcss`, `@jirawatpyk/aura-tokens/tailwind.css` (Tailwind v4 theme **and** `aura.css` tokens) and `@jirawatpyk/aura-react/styles.layer.css` (components inside `@layer aura`). The layer order lets Tailwind utilities override AURA component styles. Never also import `aura.css` or `styles.css` — that duplicates tokens and components outside the layers.
- `<AuraProvider locale="en" linkComponent={Link}>` in `apps/web/src/app/providers.tsx`. The product UI is English (PRD §9); no Thai locale pack.
- Tailwind class names map to AURA tokens (`bg-bg-surface`, `text-fg-secondary`, `border-border-default`, `font-display`, `font-mono`).
- ESLint: `@jirawatpyk/aura-tokens/eslint-plugin` (`aura.configs.recommended`) fails the lint on any hard-coded colour.
- Server Components: display components (Card, Badge, StatusPill, Alert, EmptyState, Icon) and helpers (`formatDate`, `statusTone`) come from `@jirawatpyk/aura-react/server`.

## Rules

- Use AURA components and semantic tokens as drawn. Never a raw hex, a Tailwind palette class (`bg-red-500`) or a hand-built control AURA already has.
- Icons: import components from `@jirawatpyk/aura-react/icons` (`<IconBell />`), never icon names as strings — 6.0 drops the string map. Only the 70 AURA icons; a missing one comes from Lucide unchanged.
- Enterprise register everywhere in the app. Creative (mesh, grain, offset shadows) is not used in this product.
- Status badges follow spec §11 and §14.2: Down = Badge danger solid `ban`; Problem = Badge warning soft `triangle-alert`; OK = Badge success soft `circle-check`; Maintenance = Badge accent soft `calendar` — accent is reserved for Maintenance among status badges.
- Density: default comfortable; data-heavy tables may use `density="compact"`. Touch targets stay ≥ 44 px.
- Test every page at 390, 820 and 1440 px, light and dark.

## Icons available (5.10)

`activity` `arrow-down` `arrow-left` `arrow-right` `arrow-up` `arrow-up-down` `arrow-up-right` `ban` `bell` `calendar` `chart-column` `check` `chevron-down` `chevron-left` `chevron-right` `chevron-up` `circle` `circle-alert` `circle-check` `circle-dot-dashed` `clock` `cloud-upload` `columns-3` `copy` `download` `ellipsis` `external-link` `eye` `eye-off` `file` `file-text` `filter` `folder` `globe` `house` `image` `inbox` `info` `layout-dashboard` `loader-circle` `lock` `log-out` `mail` `menu` `minus` `monitor` `moon` `panel-left-close` `panel-left-open` `paperclip` `pencil` `phone` `pin` `pin-off` `plus` `rotate-ccw` `search` `server` `settings` `shield-alert` `sun` `trash-2` `trending-down` `trending-up` `triangle-alert` `upload` `user` `users` `wrench` `x`

## Known AURA gaps found during design

The canvas's orange note listed 14 issues. As of AURA 5.10 these are fixed: StatusPill `warning` tone (5.1), Checkbox visible label (5.1, shown in 6.0), published `tokens.css`/`aura.css` with dark theme, README consuming section, fonts moved out of `bundle.css` (5.1), the six monitoring icons (5.1), SideNav top spacing and `bordered={false}` (5.1). Still check these before relying on them:

1. DataTable columns with fixed widths can overflow narrow containers (~550 px) — give one column flex, or use `stackBelow` / `hideBelow`.
2. Dialog initial focus lands on the close button — set focus to the first field or the title.
3. SideNav item `badge` has no tone — pass a `<Badge tone="danger">` element for the Fault indicator.
4. Tag with non-string children loses its remove label — always pass `removeLabel`.
5. Switch disabled + checked looks like off — for "always on" settings show Badge "Always on" instead (Security board does this).

Report new gaps to the AURA repo (github.com/Jirawatpyk/Aura-design); build project-specific components in `apps/web/src/components`, not in AURA.
