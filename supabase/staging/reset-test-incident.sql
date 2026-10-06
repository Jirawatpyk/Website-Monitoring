-- DxT Monitor · close the staging test target's open incident (S02a). STAGING ONLY.
-- Until incidents can be resolved in the app (S07 / S09) and relapses join their incident (D-004,
-- S04), an open "Test target" incident means the next DOWN test posts nothing. Run this in the
-- staging SQL editor before repeating a DOWN / RECOVERED check. It resolves the incident and writes
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

update public.site_status st set status = 'ok', ok_rounds = 0
from public.sites s
where s.id = st.site_id and s.name = 'Test target';
