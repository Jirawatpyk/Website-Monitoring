# Screen map — canvas board → route → rules

The index `/implement-screen` reads. One row per canvas board (44). The board file is in `docs/design/canvas/`; open the [live canvas](https://claude.ai/artifact/Sqa6gYe5eGqTQtBFmjbyMW) in Play mode to click through flows.

- **Phase** follows PRD §6 priority: `P0` = MVP (Phase 1), `P1` = team go-live (Phase 2), `P2` = client-facing (Phase 3). **Slice** is the slice in [`../implementation-plan.md`](../implementation-plan.md) that builds the board; work in slice order.
- **Spec** = sections of `docs/dxt-monitor-design-spec.md` that govern the screen. §11 (badges), §13 (copy & formats) and §14.15–17 (eyebrows, no dead controls, 44 px tap targets) apply to every screen and are not repeated below.
- Routes are the planned App Router paths in `apps/web/src/app`. A mobile board is the same route rendered at 390 px (spec §17), not a separate route.
- "Not a route" boards specify behaviour or message content; they are implemented in the package named.

## Web app (desktop 1440 + mobile 390)

| Board | Canvas title | Route | Phase | Slice | Spec | PRD |
|---|---|---|---|---|---|---|
| Login | Sign in — Google SSO + Admin 2-step | `/login` | P0 | S01 | §14.12, §15.2, §16.7 | §3, FR-07 |
| MLogin | Mobile — session expired from alert link | `/login?next=…` (390) | P0 | S01 | §15.2, §16.7 | §3 |
| Main | Overview dashboard | `/` | P0 | S06 | §1, §5, §11, §14.13, §15.1 | FR-05 |
| MOverview | Mobile — Overview | `/` (390) | P0 | S06 | §17 | FR-05 |
| MainDark | Overview dashboard — dark (NOC wall) | `/` with `data-theme="dark"` | P0 | S06 | §14.2, §14.13 | FR-05 |
| MainFault | Overview — monitoring degraded (heartbeat missed) | `/` fault state | P1 | S12 | §14.4, §14.6, §16.10 | FR-21, §9 |
| SiteDetail | Site detail — Bangkok Airways – Taiwan | `/sites/[siteId]` | P0 | S06 | §5, §11, §12 | FR-08 |
| MSite | Mobile — Site detail | `/sites/[siteId]` (390) | P0 | S06 | §17 | FR-08 |
| AddSite | Add site + registration checklist | `/sites/new` | P0 | S05 | §3, §8 | FR-01, §4 |
| EditMonitors | Edit monitors | `/sites/[siteId]/monitors` | P0 | S05 | §6 | FR-01 |
| Incidents | Incidents list | `/incidents` | P0 | S07 | §4, §11, §16.1 | FR-06 |
| MIncidents | Mobile — Incidents | `/incidents` (390) | P0 | S07 | §17 | FR-06 |
| Incident | Incident — INC-0142 MuvMi DOWN | `/incidents/[incidentId]` | P0 | S07 | §8, §9, §14.1, §14.3, §15.4, §16.2–3 | FR-06, FR-20 |
| MIncident | Mobile — Incident detail | `/incidents/[incidentId]` (390) | P0 | S07 | §15.6, §17 | FR-06 |
| MobileAck | Mobile — acknowledge from alert | `/incidents/[incidentId]?ack=1` (390) | P0 | S02b | §14.3, §16.8, §17 | FR-07 |
| MobileAckDark | Mobile ack — dark (night on-call) | same, dark theme | P0 | S02b | §15.7 | FR-07 |
| Resolve | Resolve incident + root cause | dialog on `/incidents/[incidentId]` | P0 | S07 | §15.4, §16.1–4 | FR-06 |
| Maintenance | Maintenance / mute dialog | `/maintenance` + dialog | P0 (mute pulled into the MVP) | S09 | §14.5, §15.1 | FR-10a, FR-14 |
| MMaintenance | Mobile — Mute / maintenance sheet | sheet (390) | P0 (mute pulled into the MVP) | S09 | §14.5, §15.1 | FR-10a, FR-14 |
| Escalation | Escalation policies | `/escalation` | P0 (L0–L1) / P1 (L2–L3) | S08 · S10 | §8, §14.1, §14.7, §15.5, §16.9 | FR-09a, FR-09b |
| OnCall | On-call rotation | `/oncall` | P1 | S10 | §2, §15.8 | FR-09b, §8 |
| MOnCall | Mobile — On-call | `/oncall` (390) | P1 | S10 | §10 (checklist) | §8 |
| Expiry | SSL & domain expiry | `/expiry` | P1 | S13 | §14.12, §15.8 | FR-11 |
| Probes | Probes & heartbeat | `/probes` | P1 | S12 | §14.4, §15.3 | §9 |
| AuditLog | Audit log | `/audit` | P1 | S15 | §16.11 | FR-13 |
| Users | Settings — users & roles | `/settings/users` | P1 — until then roles are set by a reviewed SQL script (S01) | S16 | §14.9, §15.2, §16.6 | §3 |
| Security | Settings — sign-in & security | `/settings/security` | P1 | S16 | §15.2, §16.7 | §3, §9 |
| AlertChannels | Settings — alert channels & routing | `/settings/alert-channels` | P1 | S17 | §14.8, §15.5, §15.8 | §7 |
| Organisation | Settings — organisation: tiers, clients, data, cost | `/settings/organisation` | P1 | S17 | §7, §14.14 | §4, §10 |
| Profile | My profile & notifications | `/profile` | P1 | S16 | §10 (on-call checklist) | §3 |
| Guide | User guide | `/guide` | P1 | S18 | §18 | FR-22 |
| MGuide | Mobile — User guide | `/guide` (390) | P1 | S18 | §18 | FR-22 |
| EmptyStates | Empty, loading & no-access states | shared components | P0 | S01 | §15.8, §16.1 | — |
| Reports | Uptime reports | `/reports` | P2 | S20 | §5, §12, §14.12 | FR-15 |
| ReportPDF | Monthly client report PDF (A4) | `/api/reports/[clientId]/[month]` (PDF) | P2 | S20 | §12, §16.12 | FR-15 |
| StatusPage | Client status page | `/status/[clientSlug]` (public) | P2 | S21 | §12 | FR-16 |
| MStatusPage | Client status page — mobile | `/status/[clientSlug]` (390) | P2 | S21 | §12 | FR-16 |
| PostIncident | Post-incident review — INC-0133 VOCA | `/incidents/[incidentId]/review` | P2 | S22 | §9, §15.4 | FR-18 |
| Synthetic | Synthetic check — search → booking (Phase 3) | `/sites/[siteId]/synthetic` | P2 | S23 | §6 | FR-17 |
| ApiWebhooks | Settings — API & webhooks (Phase 3) | `/settings/api` | P2 | S24 | §15.4 (held webhooks) | FR-19 |

## Routes without their own board

| Route | What it is | Phase | Built from |
|---|---|---|---|
| `/sites` | Site list — the "Sites" nav item (S05) | P0 | The all-sites table on `Main`, full width, with the Tier/owner/client filters (FR-05); rows open `/sites/[siteId]` |
| `/auth/callback` | OAuth code exchange after Google sign-in, then redirect to `safeNextPath(next)` — built (S01) | P0 | — |

Each nav item carries its slice and a `live` flag (`apps/web/src/components/app-shell/nav.tsx`); only live items show, so the sidebar never links to an unbuilt page (spec §14.16). The slice that builds the page flips it.

## Not a route — behaviour and message specs

| Board | Canvas title | Implemented in | Phase | Slice | Spec | PRD |
|---|---|---|---|---|---|---|
| StatusModel | Status model & verification logic | `packages/engine` (status, rounds, uptime) | P0 | S04 | §5, §6, §15.3 | §5, FR-03 |
| ChatAlert | Google Chat alert thread (content spec) | `packages/notifier` (Chat templates) | P0 | S02a | §10, §14.10, §15.7, §16.5 | §7 |
| EmailAlert | Alert email template | `packages/notifier` (email templates) | P0 | S02b | §10, §14.11, §15.7 | §7 |
| WeeklySummary | Weekly summary — Chat card spec | `packages/notifier` (digest + weekly) | P1 | S14 | §10, §15.7 | FR-12 |
