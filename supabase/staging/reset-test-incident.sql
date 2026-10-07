-- DxT Monitor · close the staging test target's open incident (S02a). STAGING ONLY.
-- Until incidents can be resolved in the app (S07), an open "Test target" incident takes the next
-- failure as a relapse (DOWN AGAIN, S04b). Run this in the staging SQL editor for a clean start —
-- a fresh DOWN / PROBLEM card and no flapping history. It resolves the incident and writes
-- the audit row like any state change.

with closed as (
  update public.incidents i
  set state = 'resolved', resolved_at = now(),
      root_cause_category = coalesce(root_cause_category, 'test'), root_cause = coalesce(root_cause, 'Staging test')
  from public.sites s
  where s.id = i.site_id and s.name = 'Test target'
    and i.state not in ('resolved', 'in_review', 'closed')
  returning i.id, i.state
)
insert into public.audit_log (action, entity, entity_id, after)
select 'incident.resolved', 'incident', id, jsonb_build_object('state', state, 'by', 'staging reset')
from closed;

update public.site_status st set status = 'ok', ok_rounds = 0, flips = '{}', flip_ok = null
from public.sites s
where s.id = st.site_id and s.name = 'Test target';
