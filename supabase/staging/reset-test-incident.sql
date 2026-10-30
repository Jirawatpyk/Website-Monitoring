-- DxT Monitor · close the staging test target's open incident (S02a). STAGING ONLY.
-- Incidents resolve in the app since S07, but only from Needs root cause; an open "Test target"
-- incident takes the next failure as a relapse (DOWN AGAIN, S04b). Run this in the staging SQL editor
-- for a clean start — a fresh DOWN / PROBLEM card and no flapping history. It resolves the incident
-- and writes the audit row like any state change.

with closed as (
  update public.incidents i
  set state = 'resolved', resolved_at = now(),
      root_cause_category = coalesce(root_cause_category, 'false_alarm'), root_cause = coalesce(root_cause, 'Staging test')
  from public.sites s
  where s.id = i.site_id and s.name = 'Test target'
    and i.state not in ('resolved', 'in_review', 'closed')
  returning i.id, i.state
)
insert into public.audit_log (action, entity, entity_id, after)
select 'incident.resolved', 'incident', id, jsonb_build_object('state', state, 'by', 'staging reset')
from closed;

-- Its messages still waiting go nowhere: a DOWN email held in its 5-min grace (D-047) would otherwise
-- go out after the reset (S10 /verify, INC-0051).
update public.notifications n
  set status = 'cancelled', error = 'Staging reset', next_retry_at = null
from public.incidents i join public.sites s on s.id = i.site_id
where n.incident_id = i.id and s.name = 'Test target' and n.status = 'queued';

update public.site_status st set status = 'ok', ok_rounds = 0, flips = '{}', flip_ok = null
from public.sites s
where s.id = st.site_id and s.name = 'Test target';

-- S09d: an Accept from an earlier run stays in the baseline (evil-cdn.example would never alert again),
-- so the page baseline goes back to the newest clean plain fetch — run with the target on `ok`.
with m as (
  select mo.id from public.monitors mo join public.sites s on s.id = mo.site_id
  where s.name = 'Test target' and mo.is_primary
), c as (
  select cc.id, cc.fingerprint, cc.checked_at from public.crawler_checks cc join m on m.id = cc.monitor_id
  where cc.view = 'plain' and cc.usable and cc.fingerprint is not null
    and not (cc.fingerprint->'scripts' ? 'evil-cdn.example') and cc.fingerprint->>'title' = 'Test target'
  order by cc.checked_at desc limit 1
), reset as (
  update public.page_baselines b
  set fingerprint = c.fingerprint, source_check_id = c.id, accepted_at = c.checked_at, accepted_by = null,
      reason = 'Staging reset', undo_before = null, undo_until = null, undo_by = null
  from c, m where b.monitor_id = m.id
  returning b.monitor_id, c.fingerprint
)
insert into public.audit_log (action, entity, entity_id, after)
select 'page_baseline.auto', 'monitor', monitor_id, jsonb_build_object('fingerprint', fingerprint, 'by', 'staging reset')
from reset;
