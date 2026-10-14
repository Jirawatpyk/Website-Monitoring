# Design sources

| What | Where | Use it for |
|---|---|---|
| Design canvas (44 boards) | [claude.ai/artifact/Sqa6gYe5eGqTQtBFmjbyMW](https://claude.ai/artifact/Sqa6gYe5eGqTQtBFmjbyMW) · local copy in `canvas/` | How each screen looks. Open the link in Play mode to click through flows. |
| Screen map | [`screens.md`](screens.md) | Board → route → phase → slice → governing spec sections. |
| Design spec | [`../dxt-monitor-design-spec.md`](../dxt-monitor-design-spec.md) | How screens behave: statuses, escalation, copy, formats. |
| AURA design system | [`aura.md`](aura.md) · [claude.ai/artifact/X85Noq8acCgW1oryP1vwZq](https://claude.ai/artifact/X85Noq8acCgW1oryP1vwZq) | Components, tokens, icons. |

## The local canvas copy

`canvas/` is a snapshot of the canvas taken 2026-09-28 (canvas version `1790571054-2831`); SiteDetail, AuditLog and `canvas.json` refreshed 2026-10-14 (version `1791956614-2a65`, spec §25); MSite again the same day (version `1791972765-f90c`, D-044, D-045). Each `<Board>.dc.html` holds one board's full markup plus a `DCLogic` class whose `renderVals()` carries the sample data and interactive states. Read a board to get exact layout, copy, states and which AURA component is mounted where (`component-from-global-scope="Aura.<Name>"`).

- The boards use inline styles and sample data. Rebuild them with AURA React components and real data; never copy the inline styles or the sample data into the app.
- `canvas.json` lists every board with its title and size. `aura-tokens*.css` are the canvas's own resolved tokens; the app uses `@jirawatpyk/aura-tokens` instead.
- The canvas is the source of truth for layout, copy and states; on behaviour the design spec wins, and `docs/decisions.md` wins over both (root `CLAUDE.md` → Precedence). If the canvas changes, re-download the boards and update the snapshot date above.
