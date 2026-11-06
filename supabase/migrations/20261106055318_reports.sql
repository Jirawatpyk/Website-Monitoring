-- S14 (FR-12, D-056): the daily digest and the weekly summary.
--   · `reports`: one row per report and period — the card (and the CEO's email) as rendered at 09:00, so a
--     retry sends what was true then. A fifth `notifications` subject (`report_id`); the unique key keeps a
--     cron that fires twice from posting twice.
--   · `queue_report` (service role): the row and its messages in one transaction — one Chat row for the
--     Reports Space, one email per recipient (active people only).
--   · `claim_notifications` gains `p_reports`, so a notifier that can't render report rows never claims them.
--   · `engine_sweep_minutes`: the minutes the engine cron swept (from the `engine-sweep` beat), for
--     "Monitor ran 99.7% of rounds on time · 1 gap …". Kept 35 days.
set local lock_timeout = '5s';

-- ── reports ─────────────────────────────────────────────────────────────────────────────────────────
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('daily', 'weekly')),
  -- The Bangkok date reported: the digest's day, the week's Monday.
  period_start date not null,
  chat jsonb not null check (jsonb_typeof(chat) = 'object'),
  email jsonb check (email is null or jsonb_typeof(email) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reports_once unique (kind, period_start)
);

create trigger reports_set_updated_at before update on public.reports
  for each row execute function private.set_updated_at();

alter table public.reports enable row level security;

-- Like notifications: the Admins read, only the reports cron writes.
create policy reports_select_admin on public.reports
  for select to authenticated
  using ((select public.current_app_role()) = 'admin');

revoke all on public.reports from public, anon, authenticated;
grant select on public.reports to authenticated;
grant all on public.reports to service_role;

-- ── notifications: a report is a fifth subject ──────────────────────────────────────────────────────
alter table public.notifications
  add column report_id uuid references public.reports (id) on delete restrict;
create index notifications_report_idx on public.notifications (report_id) where report_id is not null;
alter table public.notifications drop constraint notifications_one_subject;
alter table public.notifications
  add constraint notifications_one_subject
  check (num_nonnulls(incident_id, system_alert_id, maintenance_window_id, oncall_event_id, report_id) = 1)
  not valid;
create unique index notifications_once_per_report
  on public.notifications (report_id, channel, template, user_id, dedupe_key) nulls not distinct
  where status <> 'cancelled' and report_id is not null;

-- The report and its messages together. Null when this kind and period was queued already.
create function public.queue_report(
  p_kind text,
  p_period_start date,
  p_chat jsonb,
  p_email jsonb,
  p_recipients uuid[]
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_template text := case p_kind when 'daily' then 'daily_digest' else 'weekly_summary' end;
begin
  insert into public.reports (kind, period_start, chat, email)
  values (p_kind, p_period_start, p_chat, p_email)
  on conflict on constraint reports_once do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  insert into public.notifications (report_id, channel, template, thread_key)
  values (v_id, 'google_chat', v_template, 'report-' || p_kind || '-' || p_period_start::text);
  if p_email is not null then
    insert into public.notifications (report_id, channel, template, user_id, thread_key)
    select v_id, 'email', v_template, p.id, 'report-' || p_kind || '-' || p_period_start::text
    from public.profiles p
    where p.id = any (coalesce(p_recipients, '{}')) and p.is_active;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.queue_report(text, date, jsonb, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.queue_report(text, date, jsonb, jsonb, uuid[]) to service_role;

-- ── claim_notifications: report rows only for a notifier that renders them ──────────────────────────
drop function public.claim_notifications(public.notification_channel, integer, uuid, boolean);
create function public.claim_notifications(
  p_channel public.notification_channel,
  p_limit integer default 20,
  p_incident_id uuid default null,
  p_oncall boolean default false,
  p_reports boolean default false
)
returns setof public.notifications
language sql
set search_path = ''
as $$
  with due as (
    select id from public.notifications
    where status = 'queued'
      and channel = p_channel
      and (p_incident_id is null or incident_id = p_incident_id)
      -- On-call rows only for a notifier that renders them (S10 B2b); report rows likewise (S14).
      and (p_oncall or oncall_event_id is null)
      and (p_reports or report_id is null)
      and (hold_until is null or hold_until <= now())
      and (next_retry_at is null or next_retry_at <= now())
      and not exists (
        select 1 from public.notifications older
        where older.incident_id = notifications.incident_id and older.channel = notifications.channel
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
          and not (older.template in ('flap_summary', 'down', 'problem', 'down_again', 'problem_again')
                   and coalesce(older.hold_until > now(), false))
      )
      and not exists (
        select 1 from public.notifications older
        where older.maintenance_window_id = notifications.maintenance_window_id
          and older.channel = notifications.channel
          -- Chat: behind the action's own line and anything of an earlier action; one action's mention
          -- replies go together (db review M4). Email: in order per person.
          and (case when older.channel = 'google_chat'
                    then older.template = 'mw_line' or older.dedupe_key <> notifications.dedupe_key
                    else older.user_id is not distinct from notifications.user_id end)
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
      -- An on-call subject's thread goes in order (S10): a swap's request before its accept.
      and not exists (
        select 1 from public.notifications older
        where notifications.oncall_event_id is not null and older.oncall_event_id is not null
          and older.channel = notifications.channel and older.thread_key = notifications.thread_key
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
    -- Incidents and system alerts first (security review B2a): a burst of on-call, window or report rows
    -- never delays a DOWN.
    order by (incident_id is null and system_alert_id is null), created_at
    limit p_limit
    for update skip locked
  )
  update public.notifications n
    set attempts = n.attempts + 1, next_retry_at = now() + interval '90 seconds'
    from due
    where n.id = due.id
  returning n.*;
$$;

revoke execute on function public.claim_notifications(public.notification_channel, integer, uuid, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_notifications(public.notification_channel, integer, uuid, boolean, boolean)
  to service_role;

-- ── engine_sweep_minutes: when the engine cron swept ────────────────────────────────────────────────
-- A natural key (one row per minute) like probe_locations (D-014): nothing refers to a row.
create table public.engine_sweep_minutes (
  minute timestamptz primary key check (minute = date_trunc('minute', minute))
);

alter table public.engine_sweep_minutes enable row level security;

create policy engine_sweep_minutes_select_staff on public.engine_sweep_minutes
  for select to authenticated
  using ((select public.is_staff()));

revoke all on public.engine_sweep_minutes from public, anon, authenticated;
grant select on public.engine_sweep_minutes to authenticated;
grant all on public.engine_sweep_minutes to service_role;

-- Every `engine-sweep` beat (the engine cron's, `stampBeat`) records its minute. Security definer so the
-- beat's writer needs no grant of its own; a failure here never fails the beat's own write (it can't —
-- one statement, `on conflict do nothing`).
create function private.record_engine_sweep()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.name = 'engine-sweep' then
    insert into public.engine_sweep_minutes (minute)
    values (date_trunc('minute', new.last_seen_at))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function private.record_engine_sweep() from public, anon, authenticated;

create trigger agent_heartbeats_record_engine_sweep
  after insert or update of last_seen_at on public.agent_heartbeats
  for each row execute function private.record_engine_sweep();

select cron.schedule(
  'engine-sweep-minutes-retention',
  '50 17 * * *', -- 00:50 Bangkok
  $$delete from public.engine_sweep_minutes where minute < now() - interval '35 days'$$
);
