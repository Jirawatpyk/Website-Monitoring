-- Audit coverage, the database half (plan S15 Done-when 1, D-061 item 4): every volatile public
-- function that a signed-in session (`authenticated`) or the cron code (`service_role`) can execute
-- is listed below as `audited` — naming the pgTAP test that checks its audit_log row — or `exempt`
-- with the reason. A new function missing from the list fails here; a function marked audited that
-- has no path to audit_log fails here too. The web half is scripts/check-audit-coverage.mjs, which
-- reads this list (keep one row per line: ('name', 'audited' | 'exempt', 'test file | reason')).
-- Known limit: pg_cron jobs that call `private.*` functions are outside this list (today only
-- retention, rollups and the nightly series expansion, whose public twin is listed). A new cron job
-- that changes config or incident state needs its own row here and an audit row in its function.
begin;
select plan(7);

create temp table audit_classes (
  fn text primary key,
  kind text not null check (kind in ('audited', 'exempt')),
  note text not null check (length(btrim(note)) >= 8)
) on commit drop;

insert into audit_classes (fn, kind, note) values
  -- Signed-in actions (each one's own row, in the same transaction as its change)
  ('ack_incident', 'audited', 'ack.test.sql'),
  ('undo_ack', 'audited', 'ack.test.sql'),
  ('add_incident_note', 'audited', 'resolve.test.sql'),
  ('save_root_cause', 'audited', 'resolve.test.sql'),
  ('resolve_incident', 'audited', 'resolve.test.sql'),
  ('undo_resolve', 'audited', 'resolve.test.sql'),
  ('mark_client_update', 'audited', 'client_update.test.sql'),
  ('record_hand_check', 'audited', 'hand_check.test.sql'),
  ('open_manual_incident', 'audited', 'hand_check.test.sql'),
  ('escalate_now', 'audited', 'hand_check.test.sql'),
  ('send_client_update_reminder', 'audited', 'hand_check.test.sql'),
  ('report_down_by_hand', 'audited', 'hand_relapse.test.sql'),
  ('save_escalation_policies', 'audited', 'escalation.test.sql'),
  ('save_response_hours', 'audited', 'organisation_hours.test.sql'),
  ('create_maintenance', 'audited', 'maintenance.test.sql'),
  ('mute_site', 'audited', 'maintenance.test.sql'),
  ('approve_maintenance', 'audited', 'maintenance.test.sql'),
  ('decline_maintenance', 'audited', 'maintenance.test.sql'),
  ('withdraw_request', 'audited', 'maintenance.test.sql'),
  ('edit_window_end', 'audited', 'maintenance.test.sql'),
  ('end_window_early', 'audited', 'maintenance.test.sql'),
  ('cancel_window', 'audited', 'maintenance.test.sql'),
  ('undo_window_action', 'audited', 'maintenance_messages.test.sql'),
  ('create_maintenance_series', 'audited', 'maintenance_series.test.sql'),
  ('decide_maintenance_series', 'audited', 'maintenance_series.test.sql'),
  ('cancel_maintenance_series', 'audited', 'maintenance_series.test.sql'),
  ('undo_series_action', 'audited', 'series_undo.test.sql'),
  ('save_oncall_rotation', 'audited', 'oncall.test.sql'),
  ('request_oncall_swap', 'audited', 'oncall.test.sql'),
  ('respond_oncall_swap', 'audited', 'oncall.test.sql'),
  ('decide_oncall_swap', 'audited', 'oncall.test.sql'),
  ('withdraw_oncall_swap', 'audited', 'oncall.test.sql'),
  ('hand_over_oncall_shift', 'audited', 'oncall.test.sql'),
  ('invite_user', 'audited', 'users.test.sql'),
  ('revoke_invite', 'audited', 'users.test.sql'),
  ('change_user_role', 'audited', 'users.test.sql'),
  ('deactivate_user', 'audited', 'users.test.sql'),
  ('set_chat_user_id', 'audited', 'users.test.sql'),
  ('sign_out_user_everywhere', 'audited', 'users.test.sql'),
  ('sign_out_my_other_devices', 'audited', 'users.test.sql'),
  ('sign_out_my_device', 'audited', 'users.test.sql'),
  ('accept_page_baseline', 'audited', 'page_change.test.sql'),
  ('undo_page_baseline', 'audited', 'page_change.test.sql'),
  -- Sites, monitors, clients: their row trigger writes one row per changed row (D-025)
  ('create_site', 'audited', 'sites_registration.test.sql'),
  ('update_site', 'audited', 'sites_registration.test.sql'),
  ('set_site_monitoring', 'audited', 'sites_registration.test.sql'),
  ('delete_site', 'audited', 'sites_registration.test.sql'),
  ('save_monitors', 'audited', 'sites_registration.test.sql'),
  -- The engine and the crawler (System rows)
  ('engine_open_incident', 'audited', 'probes.test.sql'),
  ('engine_recover_incident', 'audited', 'probes.test.sql'),
  ('engine_relapse_incident', 'audited', 'resolve.test.sql'),
  ('engine_new_cause_incident', 'audited', 'new_cause.test.sql'),
  ('engine_cause_back_incident', 'audited', 'new_cause.test.sql'),
  ('engine_escalate_incident', 'audited', 'verifier.test.sql'),
  ('engine_settle_incident', 'audited', 'probes.test.sql'),
  ('engine_fire_step', 'audited', 'escalation.test.sql'),
  ('engine_client_update_due', 'audited', 'client_update.test.sql'),
  ('engine_log_windows', 'audited', 'maintenance.test.sql'),
  ('engine_window_reminders', 'audited', 'series_undo.test.sql'),
  ('engine_expand_series', 'audited', 'maintenance_series.test.sql'),
  ('oncall_extend_shifts', 'audited', 'oncall.test.sql'),
  ('open_system_alert', 'audited', 'verifier.test.sql'),
  ('clear_system_alert', 'audited', 'verifier.test.sql'),
  ('crawler_set_baseline', 'audited', 'page_change.test.sql'),
  ('engine_post_late_alert', 'audited', 'oncall_routing.test.sql'),
  -- Exempt: no config or incident state changes
  ('post_window_action_now', 'exempt', 'Sends early the messages an audited window action already queued.'),
  ('post_series_action_now', 'exempt', 'Sends early the messages an audited series action already queued.'),
  ('set_oncall_checklist', 'exempt', 'A person ticks their own phone-readiness checklist (MOnCall).'),
  ('send_oncall_test', 'exempt', 'Queues a test alert to the person themselves.'),
  ('confirm_oncall_test', 'exempt', 'Records that the person got their own test alert.'),
  ('claim_notifications', 'exempt', 'The notifier claims queued messages to deliver them.'),
  ('queue_fallback_emails', 'exempt', 'Queues the fallback emails for a Chat post that failed (D-016).'),
  ('queue_report', 'exempt', 'Stores the daily digest or weekly summary before it is sent.'),
  ('claim_verification_jobs', 'exempt', 'The VPS leases browser-verify jobs.'),
  ('complete_verification_job', 'exempt', 'Stores a verify verdict; the engine judges it through audited steps.'),
  ('expire_verification_jobs', 'exempt', 'Expires verify jobs whose lease ran out.'),
  ('engine_record_round', 'exempt', 'Records a check round (monitor and site status); incidents change through audited steps.'),
  ('engine_record_flip', 'exempt', 'Counts a status flip for the flapping rule.'),
  ('engine_write_monitors', 'exempt', 'Writes each monitor''s round status.'),
  ('engine_note_site', 'exempt', 'Writes the site status note (bot protection, verified via browser).'),
  ('engine_cancel_ladder', 'exempt', 'Cancels escalation messages still held for an incident that recovered.'),
  ('engine_cancel_held_problem', 'exempt', 'Cancels a held PROBLEM message whose drop recovered.'),
  ('engine_cancel_flap_summary', 'exempt', 'Cancels a held flap summary when the site drops again.'),
  ('engine_queue_l0_emails', 'exempt', 'Queues L0 emails after the grace (D-047).'),
  ('engine_queue_window_messages', 'exempt', 'Queues a window''s messages; the window change itself is audited.'),
  ('engine_queue_series_messages', 'exempt', 'Queues a series'' messages; the series change itself is audited.'),
  ('engine_remind', 'exempt', 'Queues a STILL DOWN / STILL PROBLEM reminder.'),
  ('engine_oncall_reminders', 'exempt', 'Queues the on-call week reminders.'),
  ('engine_mark_engine_back', 'exempt', 'Adds an "engine back" timeline line to incidents acted on by hand.');

-- Volatile public functions a session or the cron code can run (extension functions left out).
create function pg_temp.state_changers() returns setof text language sql stable as $$
  select distinct p.proname::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f' and p.provolatile = 'v'
    and p.prorettype <> 'trigger'::regtype
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and (has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute'))
$$;

-- A function's body without its comments: a comment that mentions audit_log proves nothing.
create function pg_temp.code(p_src text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(p_src, '/\*.*?\*/', ' ', 'gs'), '--[^\n]*', ' ', 'g')
$$;

-- A function reaches audit_log when its body inserts into it, calls a function that does, or writes
-- a table an audit trigger covers (`private.audit_row_change`). Matched on the code text, so a
-- dynamic call by name would slip through; none of ours does that (D-061 trade-off).
create function pg_temp.reaches_audit(p_fn text) returns boolean language sql stable as $$
  with writers as (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and pg_temp.code(p.prosrc) ~* 'insert\s+into\s+public\.audit_log\M'
  ),
  audited_tables as (
    select distinct c.relname from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_proc f on f.oid = t.tgfoid
    where f.proname = 'audit_row_change' and not t.tgisinternal
  )
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = p_fn
      and (pg_temp.code(p.prosrc) ~* 'insert\s+into\s+public\.audit_log\M'
           or exists (select 1 from writers w where w.proname <> p.proname
                      and pg_temp.code(p.prosrc) ~* ('\m' || w.proname || '\s*\('))
           or exists (select 1 from audited_tables a
                      where pg_temp.code(p.prosrc) ~* ('(insert\s+into|update|delete\s+from)\s+public\.' || a.relname || '\M')))
  )
$$;

create function pg_temp.unclassified() returns text[] language sql stable as $$
  select coalesce(array_agg(f order by f), '{}') from pg_temp.state_changers() f
  where f not in (select fn from audit_classes)
$$;

create function pg_temp.audited_without_audit() returns text[] language sql stable as $$
  select coalesce(array_agg(fn order by fn), '{}') from audit_classes
  where kind = 'audited' and not pg_temp.reaches_audit(fn)
$$;

select is(pg_temp.unclassified(), '{}'::text[],
  'every state-changing function is audited or exempt with a reason');

select is(
  (select coalesce(array_agg(fn order by fn), '{}') from audit_classes
   where fn not in (select pg_temp.state_changers())),
  '{}'::text[], 'no entry names a function that is gone (or no longer callable)');

select is(pg_temp.audited_without_audit(), '{}'::text[],
  'every function marked audited reaches audit_log (itself, a helper, or an audited table)');

-- A table a signed-in session can write directly (PostgREST) needs the row-change audit trigger:
-- the S15 security review found `profiles` (an Admin's role / is_active change) writing nothing.
select is(
  (select coalesce(array_agg(c.relname::text order by c.relname), '{}')
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   -- Tables, partitioned tables and views; whole-table and column-level grants alike (a later
   -- `grant update (col)` counts as a direct write too — security re-review).
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
     and (has_table_privilege('authenticated', c.oid, 'INSERT')
          or has_table_privilege('authenticated', c.oid, 'UPDATE')
          or has_table_privilege('authenticated', c.oid, 'DELETE')
          or has_any_column_privilege('authenticated', c.oid, 'INSERT')
          or has_any_column_privilege('authenticated', c.oid, 'UPDATE'))
     and not exists (select 1 from pg_trigger t join pg_proc f on f.oid = t.tgfoid
                     where t.tgrelid = c.oid and f.proname = 'audit_row_change')),
  '{}'::text[], 'every table a signed-in session can write has the row-change audit trigger');

-- ── Fixtures: a new function that changes incident state and skips audit_log ─────────────────────
create function public.zz_fixture_skips_audit(p_id uuid) returns void language sql as $$
  update public.incidents set state = 'closed' where id = p_id
$$;
grant execute on function public.zz_fixture_skips_audit(uuid) to authenticated;

select is(pg_temp.unclassified(), array['zz_fixture_skips_audit'],
  'a new state-changing function that nobody classified fails the check');

-- (an insert … select, so the web half's parser never reads the fixture as a real entry)
insert into audit_classes select 'zz_fixture_skips_audit', 'audited', 'fixture.test.sql';
select is(pg_temp.audited_without_audit(), array['zz_fixture_skips_audit'],
  'marking it audited does not help: it has no path to audit_log');

-- A comment that names audit_log doesn't count either.
create or replace function public.zz_fixture_skips_audit(p_id uuid) returns void language sql as $$
  -- insert into public.audit_log happens in the caller
  update public.incidents set state = 'closed' where id = p_id
$$;
select is(pg_temp.audited_without_audit(), array['zz_fixture_skips_audit'],
  'nor does a comment that mentions audit_log');

select * from finish();
rollback;
