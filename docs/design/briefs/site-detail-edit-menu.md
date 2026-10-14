# Brief for Claude Design: an "Edit site" entry on Site detail

**For:** the DxT Monitor design canvas. Please add one state to the existing **SiteDetail** board, and show the same header at phone width (390 px).
**Design system:** AURA, as on every other board. Reuse the **⋯ menu** the **Sites** board already draws (row menu: Open, Edit site, Mute…, Schedule maintenance).
**Decision:** Tao, 14 Oct 2026: Site detail gets a ⋯ menu with Edit site, not a fourth header button. Build after G1. **Visit site** in the same menu (below) is a proposal waiting for Tao's OK: a one-item menu reads as broken, and the Sites list has Visit site on every row.

## The gap

Site detail (`/sites/[siteId]`) is where an Admin looks at one site. Its header has three actions: **Mute**, **Schedule maintenance** and **Edit monitors** (primary). It has no way to reach **Edit site** (`/sites/[siteId]/edit`), the page that holds:

- name, URL, client, Tier;
- owner and backup;
- the behind-WAF flag;
- **Stop monitoring** and **Delete site** (drafts only).

Today an Admin who wants to change the owner, change the Tier or stop monitoring has to leave the page. They go back to `/sites`, find the row and open its ⋯ menu, or they go to Edit monitors and click the site name in the breadcrumb. Before Site detail existed, a Sites row opened Edit site directly (spec §20, D-025). When Site detail replaced that, the entry stayed only in the list's ⋯ menu and was never drawn on SiteDetail.

## What to draw

### Desktop (SiteDetail board)

- **A ⋯ icon button** (AURA secondary, icon only, `aria-label="More actions for <site name>"`) at the end of the header actions, after **Edit monitors**.
- **Its menu**, same look as the Sites row menu:
  - **Edit site** (pencil icon) → `/sites/[siteId]/edit`;
  - **Visit site** (external-link icon) → the site's URL in a new tab. The Sites list has this on every row; Site detail has none today.
- Mute and Schedule maintenance stay as buttons; don't repeat them in the menu.
- Please draw the menu **open** as one board state.

### Phone (390 px)

The header actions already stack (three buttons wrap to two halves, then one across). Please show where the ⋯ button sits:

- either as a small icon button next to the page title;
- or as the last item in the wrapped row.

We have no preference; keep tap targets at 44 px or more.

### Who sees it

| Role | Sees |
| --- | --- |
| Admin | ⋯ with Edit site and Visit site |
| Owner / backup (not Admin) | ⋯ with Visit site only; Edit site is Admin-only (Users board role matrix) |
| Everyone else | ⋯ with Visit site only |

Please show the non-Admin menu as a second state, or note it on the board. If Tao declines Visit site, the ⋯ menu is Admin-only (Edit site) and non-Admins see no ⋯.

## Not in scope

- No change to the Edit site page itself.
- No archive or hide for sites with history. Such a site can't be deleted: it is stopped, then kept for the record.
- No change to the Sites list menu.
