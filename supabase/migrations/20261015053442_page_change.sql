-- S09d (D-041, D-046): page-change detection. Every 30 min the sin1 crawler also fetches each live
-- site's home page as the monitor itself (view 'plain', the probe's own User-Agent), reads the whole
-- body and keeps a small fingerprint of what a defacer changes (title, meta description, robots,
-- canonical, first h1, script / iframe and link domains). The engine compares the latest fetches with
-- the monitor's accepted baseline (page_baselines); an Admin accepts a new one with a 10 s Undo that
-- applies only when the window closes (spec §26.6).

-- ── crawler_checks: the plain view and its fingerprint ─────────────────────
alter table public.crawler_checks drop constraint crawler_checks_view_check;
-- mirrors CRAWLER_VIEWS + FINGERPRINT_VIEW (@dxt/shared)
alter table public.crawler_checks
  add constraint crawler_checks_view_check check (view in ('googlebot', 'google_referer', 'plain'));

-- Only a usable plain fetch carries one; bounded at extraction (300-character texts, 200 domains per
-- set — FINGERPRINT_LIMITS), so this cap is a backstop.
alter table public.crawler_checks
  add column fingerprint jsonb
    check (fingerprint is null or (view = 'plain' and jsonb_typeof(fingerprint) = 'object'
                                   and octet_length(fingerprint::text) <= 32768));

-- The engine's and the pages' read: the newest plain fetches of one monitor.
create index crawler_checks_monitor_view_idx on public.crawler_checks (monitor_id, view, checked_at desc);

-- ── page_baselines ─────────────────────────────────────────────────────────
-- One per primary monitor: the fingerprint the team accepted. Set automatically from the first usable
-- plain fetch (accepted_by null), reset when the monitor's URL changes, replaced by an Admin's accept.
-- first_set_at starts the 14-day recording (D-046). An accept keeps the previous baseline in
-- undo_before until undo_until: before then the engine still compares with it and Undo restores it.
create table public.page_baselines (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid not null unique references public.monitors (id) on delete cascade,
  url text not null check (char_length(url) <= 2048),
  fingerprint jsonb not null
    check (jsonb_typeof(fingerprint) = 'object' and octet_length(fingerprint::text) <= 32768),
  first_set_at timestamptz not null,
  accepted_at timestamptz not null,
  accepted_by uuid references public.profiles (id) on delete restrict,
  reason text check (char_length(reason) <= 2000),
  -- the plain fetch the fingerprint came from (null once retention removed it)
  source_check_id uuid references public.crawler_checks (id) on delete set null,
  undo_before jsonb,
  undo_until timestamptz,
  undo_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint page_baselines_undo_complete check (
    (undo_until is null) = (undo_before is null) and (undo_until is null) = (undo_by is null)
  )
);

create index page_baselines_accepted_by_idx on public.page_baselines (accepted_by) where accepted_by is not null;
create index page_baselines_undo_by_idx on public.page_baselines (undo_by) where undo_by is not null;
create index page_baselines_source_check_idx on public.page_baselines (source_check_id)
  where source_check_id is not null;

create trigger page_baselines_set_updated_at before update on public.page_baselines
  for each row execute function private.set_updated_at();

alter table public.page_baselines enable row level security;

-- People read (staff); only the crawler and the accept / undo / resolve RPCs write.
create policy page_baselines_select_staff on public.page_baselines
  for select to authenticated
  using ((select public.is_staff()));

revoke all on public.page_baselines from public, anon, authenticated;
grant select on public.page_baselines to authenticated;
grant all on public.page_baselines to service_role;

-- ── The crawler sets the first baseline ────────────────────────────────────
-- After a usable plain fetch: no baseline yet, or the monitor's URL changed since → this fetch becomes
-- the baseline and the recording starts again (D-046 item 6). Otherwise nothing. Returns true when it
-- set one. Service role only.
create function public.crawler_set_baseline(p_check_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_check public.crawler_checks%rowtype;
  v_url text;
  v_old public.page_baselines%rowtype;
begin
  select * into v_check from public.crawler_checks where id = p_check_id;
  if not found or v_check.view <> 'plain' or not v_check.usable or v_check.fingerprint is null then
    return false;
  end if;
  select url into v_url from public.monitors where id = v_check.monitor_id and is_primary;
  if v_url is null then
    return false;
  end if;

  select * into v_old from public.page_baselines where monitor_id = v_check.monitor_id for update;
  if found and v_old.url = v_url then
    return false;
  end if;

  insert into public.page_baselines (monitor_id, url, fingerprint, first_set_at, accepted_at, source_check_id)
  values (v_check.monitor_id, v_url, v_check.fingerprint, v_check.checked_at, v_check.checked_at, v_check.id)
  on conflict (monitor_id) do update
    set url = excluded.url, fingerprint = excluded.fingerprint, first_set_at = excluded.first_set_at,
        accepted_at = excluded.accepted_at, accepted_by = null, reason = null,
        source_check_id = excluded.source_check_id, undo_before = null, undo_until = null, undo_by = null;

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('page_baseline.auto', 'monitor', v_check.monitor_id,
          case when v_old.id is null then null
               else jsonb_build_object('url', v_old.url, 'fingerprint', v_old.fingerprint) end,
          jsonb_build_object('url', v_url, 'fingerprint', v_check.fingerprint, 'check_id', v_check.id));
  return true;
end;
$$;

revoke execute on function public.crawler_set_baseline(uuid) from public, anon, authenticated;
grant execute on function public.crawler_set_baseline(uuid) to service_role;

-- ── The engine's read ──────────────────────────────────────────────────────
-- Per primary monitor of an active site that has a baseline: the baseline to compare with at p_now
-- (the previous one while an accept's Undo is open), whether an accept is waiting, first_set_at, and
-- the six newest usable plain fetches since p_since plus the newest fetch of any kind (so a blocked
-- one reads as no data). One row per monitor, under PostgREST's 1,000-row cap.
create function public.engine_page_fingerprints(p_now timestamptz, p_since timestamptz)
returns table (
  monitor_id uuid,
  baseline jsonb,
  pending_until timestamptz,
  first_set_at timestamptz,
  latest_at timestamptz,
  latest_usable boolean,
  facts jsonb
)
language sql
stable
set search_path = ''
as $$
  select b.monitor_id,
    case when b.undo_until > p_now then b.undo_before->'fingerprint' else b.fingerprint end,
    case when b.undo_until > p_now then b.undo_until end,
    b.first_set_at,
    l.checked_at,
    l.usable,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'checked_at', f.checked_at, 'fingerprint', f.fingerprint)
                       order by f.checked_at desc)
      from (
        select c.id, c.checked_at, c.fingerprint
        from public.crawler_checks c
        where c.monitor_id = b.monitor_id and c.view = 'plain' and c.usable
          and c.fingerprint is not null and c.checked_at >= p_since and c.checked_at <= p_now
        order by c.checked_at desc
        limit 6
      ) f
    ), '[]'::jsonb)
  from public.page_baselines b
  join public.monitors m on m.id = b.monitor_id and m.is_primary and m.enabled and m.removed_at is null
    and m.url = b.url
  join public.sites s on s.id = m.site_id and s.is_active
  left join lateral (
    select c.checked_at, c.usable
    from public.crawler_checks c
    where c.monitor_id = b.monitor_id and c.view = 'plain' and c.checked_at >= p_since and c.checked_at <= p_now
    order by c.checked_at desc
    limit 1
  ) l on true;
$$;

revoke execute on function public.engine_page_fingerprints(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.engine_page_fingerprints(timestamptz, timestamptz) to service_role;

-- ── Accept and Undo ────────────────────────────────────────────────────────
-- Makes plain fetch p_check_id the monitor's baseline, with the previous one kept for the 10 s Undo
-- (the engine compares with the previous one until then). Admin only (D-046) — the caller checks;
-- shared by accept_page_baseline and resolve_incident. Writes the audit row and, when the site has an
-- open Page change incident, its timeline event. Returns undo_until.
create function private.accept_baseline(p_check_id uuid, p_reason text, p_with_resolve uuid default null)
returns timestamptz
language plpgsql
set search_path = ''
as $$
declare
  v_reason text := private.require_reason(p_reason);
  v_check public.crawler_checks%rowtype;
  v_url text;
  v_site uuid;
  v_old public.page_baselines%rowtype;
  v_now timestamptz := now();
  v_until timestamptz := now() + interval '10 seconds';
  v_name text;
  v_incident uuid;
begin
  select * into v_check from public.crawler_checks where id = p_check_id;
  if not found or v_check.view <> 'plain' or not v_check.usable or v_check.fingerprint is null then
    raise exception 'This fetch can''t become the baseline' using errcode = '22023';
  end if;
  select url, site_id into v_url, v_site from public.monitors
    where id = v_check.monitor_id and is_primary and removed_at is null;
  if v_url is null then
    raise exception 'This fetch can''t become the baseline' using errcode = '22023';
  end if;

  select * into v_old from public.page_baselines where monitor_id = v_check.monitor_id for update;
  if not found or v_old.url <> v_url then
    raise exception 'The page has no baseline yet' using errcode = '55000';
  end if;
  if v_old.undo_until > v_now then
    raise exception 'A new baseline is already waiting to apply' using errcode = '55000';
  end if;

  update public.page_baselines
    set fingerprint = v_check.fingerprint, accepted_at = v_now, accepted_by = auth.uid(),
        reason = v_reason, source_check_id = v_check.id, undo_until = v_until, undo_by = auth.uid(),
        undo_before = jsonb_build_object('fingerprint', v_old.fingerprint, 'accepted_at', v_old.accepted_at,
                                         'accepted_by', v_old.accepted_by, 'reason', v_old.reason,
                                         'source_check_id', v_old.source_check_id)
    where id = v_old.id;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'page_baseline.accept', 'monitor', v_check.monitor_id,
          jsonb_build_object('fingerprint', v_old.fingerprint, 'accepted_at', v_old.accepted_at,
                             'accepted_by', v_old.accepted_by),
          jsonb_build_object('fingerprint', v_check.fingerprint, 'check_id', v_check.id, 'reason', v_reason,
                             'applies_at', v_until, 'with_resolve', p_with_resolve));

  select display_name into v_name from public.profiles where id = auth.uid();
  select id into v_incident from public.incidents
    where site_id = v_site and trigger = 'content_change'
      and (state not in ('resolved', 'in_review', 'closed') or id = p_with_resolve)
    order by started_at desc
    limit 1;
  if v_incident is not null then
    insert into public.incident_events (incident_id, type, actor_id, payload, at)
    values (v_incident, 'baseline_accepted', auth.uid(),
            jsonb_build_object('by', v_name, 'reason', v_reason, 'applies_at', v_until,
                               'check_id', v_check.id, 'with_resolve', p_with_resolve is not null),
            v_now);
  end if;
  return v_until;
end;
$$;

-- Puts the previous baseline back inside the Undo window. p_actor_check: only the person who
-- accepted may undo (resolve's Undo already checked its own actor). Returns false when nothing waits.
create function private.undo_baseline(p_monitor_id uuid, p_actor_check boolean)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_b public.page_baselines%rowtype;
  v_site uuid;
  v_incident uuid;
  v_name text;
begin
  select * into v_b from public.page_baselines where monitor_id = p_monitor_id for update;
  if not found or v_b.undo_until is null or v_b.undo_until <= now() then
    return false;
  end if;
  if p_actor_check and v_b.undo_by is distinct from auth.uid() then
    raise exception 'Only the person who accepted it can undo it' using errcode = '42501';
  end if;

  update public.page_baselines
    set fingerprint = v_b.undo_before->'fingerprint',
        accepted_at = (v_b.undo_before->>'accepted_at')::timestamptz,
        accepted_by = (v_b.undo_before->>'accepted_by')::uuid,
        reason = v_b.undo_before->>'reason',
        source_check_id = (
          select c.id from public.crawler_checks c where c.id = (v_b.undo_before->>'source_check_id')::uuid
        ),
        undo_before = null, undo_until = null, undo_by = null
    where id = v_b.id;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'page_baseline.undo', 'monitor', p_monitor_id,
          jsonb_build_object('fingerprint', v_b.fingerprint, 'reason', v_b.reason),
          jsonb_build_object('fingerprint', v_b.undo_before->'fingerprint'));

  -- the timeline that got this accept's event
  select site_id into v_site from public.monitors where id = p_monitor_id;
  select e.incident_id into v_incident from public.incident_events e
    join public.incidents i on i.id = e.incident_id and i.site_id = v_site
    where e.type = 'baseline_accepted' and (e.payload->>'applies_at')::timestamptz = v_b.undo_until
    order by e.at desc
    limit 1;
  if v_incident is not null then
    select display_name into v_name from public.profiles where id = auth.uid();
    insert into public.incident_events (incident_id, type, actor_id, payload)
    values (v_incident, 'baseline_undone', auth.uid(), jsonb_build_object('by', v_name));
  end if;
  return true;
end;
$$;

revoke execute on function private.accept_baseline(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function private.undo_baseline(uuid, boolean) from public, anon, authenticated;

-- Accept as new baseline (Incident and Site detail, spec §26.5). Admin only. Errors: 42501 not an
-- Admin · 22023 no reason / not a usable plain fetch · 55000 no baseline / one already waiting.
create function public.accept_page_baseline(p_check_id uuid, p_reason text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.current_app_role() = 'admin', false) then
    raise exception 'Only an Admin can accept a new baseline' using errcode = '42501';
  end if;
  return private.accept_baseline(p_check_id, p_reason);
end;
$$;

-- Undo inside the 10 s window, by the Admin who accepted. Errors: 42501 · 55000 the window closed.
create function public.undo_page_baseline(p_monitor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.current_app_role() = 'admin', false) then
    raise exception 'Only an Admin can accept a new baseline' using errcode = '42501';
  end if;
  if not private.undo_baseline(p_monitor_id, true) then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;
end;
$$;

revoke execute on function public.accept_page_baseline(uuid, text), public.undo_page_baseline(uuid)
  from public, anon;
grant execute on function public.accept_page_baseline(uuid, text), public.undo_page_baseline(uuid)
  to authenticated;

-- ── Resolve with "Also accept the current page as the new baseline" ────────
-- resolve_incident as in S07 (20261009120515), plus p_accept_check_id (spec §26.7, D-046 item 9): on a
-- Page change incident, an Admin who picks Client-side change may accept that plain fetch as the
-- baseline (What happened = the reason) and resolve at once — the only resolve that doesn't wait for
-- 2 OK rounds. The ladder still waiting is set aside, as a recovery would. The old 4-argument
-- function is dropped first: a defaulted 5th parameter beside it would make PostgREST's 4-argument
-- call ambiguous.
drop function public.resolve_incident(uuid, text, text, text);

create function public.resolve_incident(
  p_incident_id uuid,
  p_category text,
  p_what text,
  p_fix text,
  p_accept_check_id uuid default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_now timestamptz := now();
  v_hold timestamptz := now() + interval '10 seconds';
  v_rc jsonb;
  v_name text;
  v_context jsonb;
  v_accept boolean := p_accept_check_id is not null;
  v_check_site uuid;
begin
  select * into v_inc from public.incidents where id = p_incident_id for no key update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(v_inc.site_id) then
    raise exception 'This role can''t resolve this incident' using errcode = '42501';
  end if;
  if v_inc.state in ('resolved', 'in_review', 'closed') then
    raise exception 'This incident is already resolved' using errcode = '55000';
  end if;
  v_rc := private.root_cause_input(p_category, p_what, p_fix);

  if v_accept then
    if not coalesce(public.current_app_role() = 'admin', false) then
      raise exception 'Only an Admin can accept a new baseline' using errcode = '42501';
    end if;
    if v_inc.trigger <> 'content_change' or v_rc->>'category' <> 'client_change' then
      raise exception 'Only a Page change resolved as a client-side change can accept the page'
        using errcode = '22023';
    end if;
    select m.site_id into v_check_site
      from public.crawler_checks c join public.monitors m on m.id = c.monitor_id
      where c.id = p_accept_check_id;
    if v_check_site is distinct from v_inc.site_id then
      raise exception 'This fetch can''t become the baseline' using errcode = '22023';
    end if;
  elsif v_inc.state not in ('monitoring', 'needs_root_cause') or v_inc.recovered_at is null
     or not exists (select 1 from public.incident_events
                    where incident_id = p_incident_id and type = 'ok_two_rounds'
                      and at >= v_inc.recovered_at) then
    raise exception 'It needs 2 OK rounds in a row before it can be resolved' using errcode = '55000';
  end if;
  if v_inc.client_update_required and v_inc.client_updated_at is null then
    raise exception 'Mark the client update first' using errcode = '55000';
  end if;
  if v_rc->>'category' = 'unknown' then
    raise exception 'Unknown keeps the incident open — pick a category' using errcode = '55000';
  end if;

  if v_accept then
    perform private.accept_baseline(p_accept_check_id, v_rc->>'what', p_incident_id);
    perform public.engine_cancel_ladder(p_incident_id, 'Resolved with a new baseline');
    perform public.engine_cancel_held_problem(p_incident_id, 'Resolved with a new baseline');
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();
  v_context := jsonb_build_object('resolvedBy', v_name, 'resolvedById', auth.uid(),
                                  'resolvedAt', v_now) || v_rc;

  update public.incidents
    set state = 'resolved', resolved_at = v_now, resolved_by = auth.uid(),
        root_cause_category = v_rc->>'category', root_cause = v_rc->>'what',
        root_cause_fix = v_rc->>'fix'
    where id = p_incident_id;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.resolved', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state, 'category', v_inc.root_cause_category,
                             'what', v_inc.root_cause, 'fix', v_inc.root_cause_fix),
          jsonb_build_object('state', 'resolved', 'resolved_at', v_now,
                             'accepted_check', p_accept_check_id) || v_rc);

  -- A held flapping summary would read after RESOLVED; Undo puts it back.
  update public.notifications
    set status = 'cancelled', error = 'Superseded: resolved', next_retry_at = null
    where incident_id = p_incident_id and template = 'flap_summary'
      and status = 'queued' and attempts = 0;

  insert into public.notifications (incident_id, channel, template, thread_key, context, hold_until)
  select p_incident_id, 'google_chat', 'resolved', p_incident_id::text, v_context, v_hold
  where exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat'
      and template in ('down', 'problem') and status <> 'cancelled'
  )
  on conflict do nothing;

  insert into public.notifications
    (incident_id, user_id, channel, template, thread_key, context, hold_until)
  select distinct p_incident_id, n.user_id, 'email'::public.notification_channel, 'resolved',
         p_incident_id::text, v_context, v_hold
  from public.notifications n
  join public.profiles p on p.id = n.user_id and p.is_active
  where n.incident_id = p_incident_id and n.channel = 'email' and n.status = 'sent'
  on conflict do nothing;

  insert into public.incident_events (incident_id, type, actor_id, payload, at)
  values (p_incident_id, 'resolved', auth.uid(),
          v_rc || jsonb_build_object('by', v_name, 'from', v_inc.state, 'posts_at', v_hold,
            'accepted_check', p_accept_check_id,
            'notifies', exists (select 1 from public.notifications
                                where incident_id = p_incident_id and template = 'resolved'
                                  and status = 'queued')),
          v_now);

  return v_hold;
end;
$$;

revoke execute on function public.resolve_incident(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.resolve_incident(uuid, text, text, text, uuid) to authenticated;

-- undo_resolve as in S07, plus: a resolve that accepted a baseline puts the previous baseline back
-- (its window opened in the same transaction, so it is still open while the resolve's is).
create or replace function public.undo_resolve(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_from public.incident_state;
  v_accepted uuid;
begin
  select * into v_inc from public.incidents where id = p_incident_id for no key update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if v_inc.state <> 'resolved' or v_inc.resolved_by is null or v_inc.auto_resolved then
    raise exception 'Nothing to undo' using errcode = '55000';
  end if;
  if v_inc.resolved_by is distinct from auth.uid() then
    raise exception 'Only the person who resolved it can undo it' using errcode = '42501';
  end if;
  if now() >= v_inc.resolved_at + interval '10 seconds' then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;

  perform 1 from public.notifications
    where incident_id = p_incident_id and template = 'resolved' and status = 'queued'
    for update;
  if exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and template = 'resolved'
      and (status = 'sent' or (status = 'queued' and attempts > 0))
  ) then
    raise exception 'The undo window has closed' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.incidents
    where site_id = v_inc.site_id and id <> p_incident_id
      and state not in ('resolved', 'in_review', 'closed')
  ) then
    raise exception 'The site has a new incident — this one stays resolved' using errcode = '55000';
  end if;

  update public.notifications
    set status = 'cancelled', next_retry_at = null
    where incident_id = p_incident_id and template = 'resolved' and status = 'queued';

  update public.notifications
    set status = 'queued', error = null, next_retry_at = null
    where incident_id = p_incident_id and template = 'flap_summary' and status = 'cancelled'
      and error = 'Superseded: resolved';

  select (payload->>'from')::public.incident_state, (payload->>'accepted_check')::uuid
    into v_from, v_accepted
  from public.incident_events
  where incident_id = p_incident_id and type = 'resolved'
  order by at desc
  limit 1;
  v_from := coalesce(v_from, 'needs_root_cause');

  if v_accepted is not null then
    perform private.undo_baseline(c.monitor_id, false)
      from public.crawler_checks c where c.id = v_accepted;
  end if;

  begin
    update public.incidents
      set state = v_from, resolved_at = null, resolved_by = null
      where id = p_incident_id;
  exception when unique_violation then
    -- The engine opened a new incident for the site between the check above and here.
    raise exception 'The site has a new incident — this one stays resolved' using errcode = '55000';
  end;

  insert into public.incident_events (incident_id, type, actor_id, payload)
  values (p_incident_id, 'resolve_undone', auth.uid(), jsonb_build_object('state', v_from));

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.resolve_undone', 'incident', p_incident_id,
          jsonb_build_object('state', 'resolved', 'resolved_at', v_inc.resolved_at),
          jsonb_build_object('state', v_from));
end;
$$;
