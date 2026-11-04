-- S12a · monitor-fault detection (FR-21, PRD §9, spec §14.4, §15.3, D-053).
--   · agent_heartbeats also keeps the Vercel side's own beats: `engine-sweep` (stamped by the engine cron
--     route only — the engine also runs after every Bangkok ingest, so only the cron sweep stopping is a
--     fault), `notifier`, `crawler`, and the VPS watchdog's `vps-watchdog`. The Overview fault banner, the
--     Probes page and the watchdog (through the ingest response) all read the same rows.
--   · system_alerts adds `probe_location_missing`: one probe location missing > 3 min while the others
--     beat and the engine sweep runs — one email per active Admin, no page (spec §15.3, §19.5).

set local lock_timeout = '5s';

alter table public.agent_heartbeats drop constraint agent_heartbeats_name_check;
alter table public.agent_heartbeats add constraint agent_heartbeats_name_check
  check (name in ('verifier', 'engine-sweep', 'notifier', 'crawler', 'vps-watchdog'));

alter table public.system_alerts drop constraint system_alerts_kind_check;
alter table public.system_alerts add constraint system_alerts_kind_check
  check (kind in ('verifier_unavailable', 'verifier_backlog', 'probe_locations_low', 'bkk_control_failing',
                  'probe_location_missing'));
