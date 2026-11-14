-- S16 PR 4 (spec §34, D-062 item 13, EmailAlert › Account · role change): the role-change and
-- access-removed email.
--   · `account_events`: one row per role change or deactivation, written by the same transaction,
--     after every check has passed (a refused change leaves nothing). It freezes what the email says:
--     the actor's name, the places that moved and who has them now (read from the rows after the
--     reassignment, never from the request), and for a promotion to Admin the other Admins' names.
--     Service role only: staff never read it (its notes name places and people).
--   · `notifications` names a seventh subject, the account event: one email row to the event's own
--     person, never threaded, never a Chat row. The notifier sends a `deactivated` one although the
--     person is inactive — the only such exception (D-062 item 13).
--   · `claim_notifications` takes `p_account`, so a notifier that can't render account rows never
--     claims them, and one person's account emails leave in order.
set local lock_timeout = '5s';

-- ── account_events ─────────────────────────────────────────────────────────────────────────────────
-- Append-only and kept, as the audit log: profiles are never hard-deleted (restrict).
create table public.account_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('role_changed', 'deactivated')),
  user_id uuid not null references public.profiles (id) on delete restrict,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  from_role public.app_role not null,
  to_role public.app_role,
  -- { actor, was_am, manages_clients, left_rotation, admins: [name], moves: [{ kind, place | starts + ends, with }] }
  facts jsonb not null,
  created_at timestamptz not null default now(),
  check ((kind = 'deactivated') = (to_role is null))
);
create index account_events_user_idx on public.account_events (user_id, created_at desc);
alter table public.account_events enable row level security;
-- No policy: only the notifier (service role) reads it.
revoke all on public.account_events from public, anon, authenticated;
grant select on public.account_events to service_role;

-- ── notifications: an account event is a seventh subject ──────────────────────────────────────────
alter table public.notifications
  add column account_event_id uuid references public.account_events (id) on delete restrict;
create index notifications_account_idx on public.notifications (account_event_id)
  where account_event_id is not null;
alter table public.notifications drop constraint notifications_one_subject;
alter table public.notifications
  add constraint notifications_one_subject
  check (num_nonnulls(incident_id, system_alert_id, maintenance_window_id, oncall_event_id, report_id,
                      maintenance_series_id, account_event_id) = 1)
  not valid;
create unique index notifications_once_per_account
  on public.notifications (account_event_id, channel, template, user_id) nulls not distinct
  where status <> 'cancelled' and account_event_id is not null;

-- ── What the person holds that a change to `p_role` moves (null = deactivation) ───────────────────
-- The same rules as private.user_reassign: owner / backup / shifts / rotation unless they stay an
-- Admin or Responder, Site AM unless they stay staff who can be one.
create function private.account_holdings(p_user uuid, p_role public.app_role)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_needs_owner boolean := p_role is null or p_role not in ('admin', 'responder');
  v_needs_am boolean := p_role is null or p_role not in ('admin', 'responder', 'stakeholder');
begin
  return jsonb_build_object(
    'owner', case when v_needs_owner then
      (select coalesce(jsonb_agg(s.id), '[]'::jsonb) from public.sites s where s.primary_owner_id = p_user)
      else '[]'::jsonb end,
    'backup', case when v_needs_owner then
      (select coalesce(jsonb_agg(s.id), '[]'::jsonb) from public.sites s where s.backup_owner_id = p_user)
      else '[]'::jsonb end,
    'am', case when v_needs_am then
      (select coalesce(jsonb_agg(c.id), '[]'::jsonb) from public.clients c where c.am_user_id = p_user)
      else '[]'::jsonb end,
    'shifts', case when v_needs_owner then
      (select coalesce(jsonb_agg(jsonb_build_object('id', sh.id, 'starts', sh.starts_at, 'ends', sh.ends_at)
                                 order by sh.starts_at), '[]'::jsonb)
       from public.oncall_shifts sh where sh.user_id = p_user and sh.ends_at > now())
      else '[]'::jsonb end,
    'rotation', v_needs_owner and exists (select 1 from public.oncall_rotation r where r.user_id = p_user),
    'was_am', exists (select 1 from public.clients c where c.am_user_id = p_user)
  );
end;
$$;
revoke execute on function private.account_holdings(uuid, public.app_role) from public, anon, authenticated;

-- ── The event and its one email, from the rows as they are after the change ───────────────────────
-- `p_before` is account_holdings from before the reassignment. A place still held by the person
-- (nothing moved) is left out. A live shift is split by the hand-over: its rest is the row handed over
-- from the person that ends when the old one did (db review H1).
create function private.account_event(p_kind text, p_user public.profiles, p_to public.app_role, p_before jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_moves jsonb;
begin
  select coalesce(jsonb_agg(q.m order by q.ord, q.sort), '[]'::jsonb) into v_moves
  from (
    select 1 as ord, s.name as sort, jsonb_build_object('kind', 'owner', 'place', s.name, 'with', p.display_name) as m
      from jsonb_array_elements_text(p_before -> 'owner') x (id)
      join public.sites s on s.id = x.id::uuid
      join public.profiles p on p.id = s.primary_owner_id
      where s.primary_owner_id <> p_user.id
    union all
    select 2, s.name, jsonb_build_object('kind', 'backup', 'place', s.name, 'with', p.display_name)
      from jsonb_array_elements_text(p_before -> 'backup') x (id)
      join public.sites s on s.id = x.id::uuid
      join public.profiles p on p.id = s.backup_owner_id
      where s.backup_owner_id <> p_user.id
    union all
    select 3, c.name, jsonb_build_object('kind', 'am', 'place', c.name, 'with', p.display_name)
      from jsonb_array_elements_text(p_before -> 'am') x (id)
      join public.clients c on c.id = x.id::uuid
      join public.profiles p on p.id = c.am_user_id
      where c.am_user_id <> p_user.id
    union all
    select 4, x ->> 'starts',
           jsonb_build_object('kind', 'shift', 'starts', x -> 'starts', 'ends', x -> 'ends', 'with', p.display_name)
      from jsonb_array_elements(p_before -> 'shifts') x
      cross join lateral (
        select coalesce(
          (select sh.user_id from public.oncall_shifts sh
            where sh.id = (x ->> 'id')::uuid and sh.user_id <> p_user.id),
          (select sh.user_id from public.oncall_shifts sh
            where sh.handed_over_from = p_user.id and sh.ends_at = (x ->> 'ends')::timestamptz
              and sh.user_id <> p_user.id
            order by sh.created_at desc limit 1)) as holder
      ) h
      join public.profiles p on p.id = h.holder
  ) q;

  insert into public.account_events (kind, user_id, actor_id, from_role, to_role, facts)
  values (p_kind, p_user.id, auth.uid(), p_user.role, p_to, jsonb_build_object(
    'actor', (select a.display_name from public.profiles a where a.id = auth.uid()),
    'was_am', coalesce((p_before ->> 'was_am')::boolean, false),
    'manages_clients', exists (select 1 from public.clients c where c.am_user_id = p_user.id),
    'left_rotation', coalesce((p_before ->> 'rotation')::boolean, false)
                     and not exists (select 1 from public.oncall_rotation r where r.user_id = p_user.id),
    'admins', case when p_to = 'admin' then
      (select coalesce(jsonb_agg(a.display_name order by a.display_name), '[]'::jsonb)
       from public.profiles a where a.role = 'admin' and a.is_active and a.id <> p_user.id)
      else '[]'::jsonb end,
    'moves', v_moves))
  returning id into v_id;

  -- One email, to the person only (spec §34): no Chat row, nobody else.
  insert into public.notifications (account_event_id, channel, template, user_id, thread_key)
  values (v_id, 'email', 'account_email', p_user.id, 'account-' || v_id);
  return v_id;
end;
$$;
revoke execute on function private.account_event(text, public.profiles, public.app_role, jsonb)
  from public, anon, authenticated;

-- ── change_user_role / deactivate_user: PR 1's bodies plus the event, written last ────────────────
create or replace function public.change_user_role(p_user_id uuid, p_role public.app_role, p_reassign jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_before jsonb;
begin
  perform private.lock_people('Only an Admin can change roles');
  perform private.staff_role(p_role);
  v := private.user_for_change(p_user_id);
  if v.role = p_role then
    raise exception 'They are % already', p_role using errcode = '22023', hint = 'same_role';
  end if;
  v_before := private.account_holdings(v.id, p_role);
  perform private.user_reassign(v.id, p_role, p_reassign,
                                format('%s is now %s', v.display_name, initcap(p_role::text)));
  perform private.assert_user_free(v, p_role);
  update public.profiles set role = p_role where id = v.id;
  update private.allowed_emails set role = p_role where email = v.email;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'user.role_change', 'user', v.id, jsonb_build_object('role', v.role),
          jsonb_build_object('role', p_role));
  -- The email (spec §34), once everything above has passed.
  perform private.account_event('role_changed', v, p_role, v_before);
end;
$$;

create or replace function public.deactivate_user(p_user_id uuid, p_reassign jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_sessions integer;
  v_before jsonb;
begin
  perform private.lock_people('Only an Admin can deactivate people');
  v := private.user_for_change(p_user_id);
  v_before := private.account_holdings(v.id, null);
  perform private.user_reassign(v.id, null, p_reassign, format('%s was deactivated', v.display_name));
  perform private.assert_user_free(v, null);
  update public.profiles set is_active = false where id = v.id;
  delete from private.allowed_emails where email = v.email;
  -- A date, not 'infinity': Auth reads the column into a Go time, which can't hold infinity.
  update auth.users set banned_until = now() + interval '100 years' where id = v.id;
  delete from auth.sessions where user_id = v.id;
  get diagnostics v_sessions = row_count;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'user.deactivate', 'user', v.id, jsonb_build_object('role', v.role, 'active', true),
          jsonb_build_object('active', false, 'devices_signed_out', v_sessions));
  -- The Access removed email (spec §34 item 6), once everything above has passed.
  perform private.account_event('deactivated', v, null, v_before);
end;
$$;

-- ── claim_notifications: account rows only for a notifier that renders them ────────────────────────
drop function public.claim_notifications(public.notification_channel, integer, uuid, boolean, boolean, boolean);
create function public.claim_notifications(
  p_channel public.notification_channel,
  p_limit integer default 20,
  p_incident_id uuid default null,
  p_oncall boolean default false,
  p_reports boolean default false,
  p_series boolean default false,
  p_account boolean default false
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
      -- On-call rows only for a notifier that renders them (S10 B2b); report, series and account rows likewise.
      and (p_oncall or oncall_event_id is null)
      and (p_reports or report_id is null)
      and (p_series or maintenance_series_id is null)
      and (p_account or account_event_id is null)
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
      -- A series' thread as a window's (S14 PR 2b): Chat behind its line and earlier actions, email per person.
      and not exists (
        select 1 from public.notifications older
        where older.maintenance_series_id = notifications.maintenance_series_id
          and older.channel = notifications.channel
          and (case when older.channel = 'google_chat'
                    then older.template = 'ms_line' or older.dedupe_key <> notifications.dedupe_key
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
      -- One person's account emails in order (S16 PR 4, db review M3): two quick changes arrive as made.
      and not exists (
        select 1 from public.notifications older
        where notifications.account_event_id is not null and older.account_event_id is not null
          and older.channel = notifications.channel
          and older.user_id is not distinct from notifications.user_id
          and older.status = 'queued' and older.created_at < notifications.created_at
      )
    -- Incidents and system alerts first (security review B2a): a burst of on-call, window, report or
    -- account rows never delays a DOWN.
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

revoke execute on function public.claim_notifications(public.notification_channel, integer, uuid, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_notifications(public.notification_channel, integer, uuid, boolean, boolean, boolean, boolean)
  to service_role;
