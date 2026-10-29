-- S10 PR B0 · on-call (FR-09b; spec §2, §7, §15.8, §27; D-009, D-048). Schema only: the code that
-- reads it (routing, screens, messages) comes in B1 / B2, so this merges without a schema lag.
--   · oncall_rotation — the order people take weekly shifts in (Admin edits).
--   · oncall_shifts   — the weeks themselves, Monday 09:00 → Monday 09:00 Bangkok, generated ahead
--                       from the rotation; a hand-over splits the live one.
--   · oncall_swaps    — a swap of two future weeks: the person asked accepts, then an Admin approves
--                       (D-048 item 4, §27.1). No Undo (§27.1).
--   · oncall_checklist — each person's phone checklist and test alert (§10, §27.8).
--   · oncall_events   — what happened, for the messages B2 sends (notifications gain this subject).
--   · incidents.l0_user_id — the L0 person frozen when the ladder clock starts (B1 fills it).
-- Every people-facing change goes through a security definer RPC that writes one audit row.

-- ── Tables ───────────────────────────────────────────────────────────────
create table public.oncall_rotation (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete restrict,
  position smallint not null check (position >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (position) deferrable initially deferred
);

create table public.oncall_shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  -- A hand-over (§27 / Users "Hand over shift"): who had it, and why.
  handed_over_from uuid references public.profiles (id) on delete set null,
  handover_reason text check (handover_reason is null or length(handover_reason) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (starts_at)
);
create index oncall_shifts_window_idx on public.oncall_shifts (starts_at, ends_at);
create index oncall_shifts_user_idx on public.oncall_shifts (user_id, starts_at);

create table public.oncall_swaps (
  id uuid primary key default gen_random_uuid(),
  requester_shift_id uuid not null references public.oncall_shifts (id) on delete restrict,
  counterpart_shift_id uuid not null references public.oncall_shifts (id) on delete restrict,
  requester_id uuid not null references public.profiles (id) on delete restrict,
  counterpart_id uuid not null references public.profiles (id) on delete restrict,
  reason text check (reason is null or length(reason) <= 500),
  status text not null default 'waiting'
    check (status in ('waiting', 'accepted', 'declined', 'approved', 'admin_declined', 'withdrawn')),
  responded_at timestamptz,
  response_note text check (response_note is null or length(response_note) <= 500),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_shift_id <> counterpart_shift_id and requester_id <> counterpart_id)
);
-- One open request per week (§27: "A swap is already waiting").
create unique index oncall_swaps_open_requester on public.oncall_swaps (requester_shift_id)
  where status in ('waiting', 'accepted');
create unique index oncall_swaps_open_counterpart on public.oncall_swaps (counterpart_shift_id)
  where status in ('waiting', 'accepted');
create index oncall_swaps_counterpart_idx on public.oncall_swaps (counterpart_id, created_at desc);

create table public.oncall_checklist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  mentions_only boolean not null default false,
  dnd_allowed boolean not null default false,
  test_sent_at timestamptz,
  -- The test link's secret: only the RPCs read it (column grants below).
  test_token uuid,
  test_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.oncall_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'rotation_changed', 'swap_requested', 'swap_accepted', 'swap_declined', 'swap_approved',
    'swap_admin_declined', 'swap_withdrawn', 'handed_over', 'test_alert', 'shift_reminder')),
  actor_id uuid references public.profiles (id) on delete set null,
  user_id uuid references public.profiles (id) on delete set null,
  swap_id uuid references public.oncall_swaps (id) on delete restrict,
  shift_id uuid references public.oncall_shifts (id) on delete restrict,
  payload jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index oncall_events_at_idx on public.oncall_events (at desc);
-- The day-before reminder goes once per shift (B2's cron step).
create unique index oncall_events_one_reminder on public.oncall_events (shift_id) where kind = 'shift_reminder';

-- A fourth message subject: an incident, a system alert, a maintenance window — or an on-call event.
alter table public.notifications
  add column oncall_event_id uuid references public.oncall_events (id) on delete restrict;
create index notifications_oncall_idx on public.notifications (oncall_event_id) where oncall_event_id is not null;
alter table public.notifications drop constraint notifications_one_subject;
alter table public.notifications
  add constraint notifications_one_subject
  check (num_nonnulls(incident_id, system_alert_id, maintenance_window_id, oncall_event_id) = 1);
create unique index notifications_once_per_oncall_event
  on public.notifications (oncall_event_id, channel, template, user_id, dedupe_key) nulls not distinct
  where status <> 'cancelled' and oncall_event_id is not null;

-- The L0 person, frozen when the ladder clock starts (open, D-021 raise, late alert): the owner, or the
-- person on call for Tier 1 outside response hours (B1). Null = the site's owner (incidents before B1).
alter table public.incidents
  add column l0_user_id uuid references public.profiles (id) on delete set null;

create trigger oncall_rotation_set_updated_at before update on public.oncall_rotation
  for each row execute function private.set_updated_at();
create trigger oncall_shifts_set_updated_at before update on public.oncall_shifts
  for each row execute function private.set_updated_at();
create trigger oncall_swaps_set_updated_at before update on public.oncall_swaps
  for each row execute function private.set_updated_at();
create trigger oncall_checklist_set_updated_at before update on public.oncall_checklist
  for each row execute function private.set_updated_at();

-- ── RLS: staff read; nobody writes directly ──────────────────────────────
alter table public.oncall_rotation enable row level security;
alter table public.oncall_shifts enable row level security;
alter table public.oncall_swaps enable row level security;
alter table public.oncall_checklist enable row level security;
alter table public.oncall_events enable row level security;

create policy oncall_rotation_select_staff on public.oncall_rotation
  for select to authenticated using ((select public.is_staff()));
create policy oncall_shifts_select_staff on public.oncall_shifts
  for select to authenticated using ((select public.is_staff()));
create policy oncall_swaps_select_staff on public.oncall_swaps
  for select to authenticated using ((select public.is_staff()));
create policy oncall_checklist_select_staff on public.oncall_checklist
  for select to authenticated using ((select public.is_staff()));
create policy oncall_events_select_staff on public.oncall_events
  for select to authenticated using ((select public.is_staff()));

grant select on public.oncall_rotation, public.oncall_shifts, public.oncall_swaps, public.oncall_events
  to authenticated;
-- The checklist without its secret token.
grant select (id, user_id, mentions_only, dnd_allowed, test_sent_at, test_received_at, created_at, updated_at)
  on public.oncall_checklist to authenticated;
grant all on public.oncall_rotation, public.oncall_shifts, public.oncall_swaps, public.oncall_checklist,
  public.oncall_events to service_role;

-- ── Helpers ──────────────────────────────────────────────────────────────
-- Monday 09:00 Bangkok of the week holding `p_at`: shifts change then (OnCall board footnote).
create function public.oncall_week_start(p_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((date_trunc('week', p_at at time zone 'Asia/Bangkok') + interval '9 hours') at time zone 'Asia/Bangkok')
         - case when p_at < ((date_trunc('week', p_at at time zone 'Asia/Bangkok') + interval '9 hours') at time zone 'Asia/Bangkok')
                then interval '7 days' else interval '0' end;
$$;

-- Who holds the on-call shift at `p_at` (an active person), or null.
create function public.oncall_person_at(p_at timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.user_id from public.oncall_shifts s join public.profiles p on p.id = s.user_id and p.is_active
  where s.starts_at <= p_at and p_at < s.ends_at
  order by s.starts_at desc limit 1;
$$;

create function private.oncall_event(
  p_kind text, p_user uuid, p_swap uuid, p_shift uuid, p_payload jsonb default '{}'::jsonb
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.oncall_events (kind, actor_id, user_id, swap_id, shift_id, payload)
  values (p_kind, auth.uid(), p_user, p_swap, p_shift, coalesce(p_payload, '{}'::jsonb))
  returning id;
$$;

-- Generate weekly shifts from the rotation, after the last one, until `p_until`. Weeks already
-- scheduled keep their person (OnCall "Edit rotation": "Use Swap for those"). Service role and the
-- rotation RPC only.
create function public.oncall_extend_shifts(p_until timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_people uuid[];
  v_start timestamptz;
  v_last uuid;
  v_idx integer;
  v_made integer := 0;
begin
  select array_agg(r.user_id order by r.position) into v_people
  from public.oncall_rotation r join public.profiles p on p.id = r.user_id and p.is_active;
  if v_people is null then
    return 0;
  end if;
  select s.ends_at, s.user_id into v_start, v_last
  from public.oncall_shifts s order by s.ends_at desc limit 1;
  if v_start is null then
    v_start := public.oncall_week_start(now());
  end if;
  -- The next person after whoever had the last week; from the top when they left the rotation.
  v_idx := coalesce(array_position(v_people, v_last), 0);
  while v_start < p_until loop
    v_idx := v_idx % cardinality(v_people) + 1;
    insert into public.oncall_shifts (user_id, starts_at, ends_at)
    values (v_people[v_idx], v_start, v_start + interval '7 days')
    on conflict (starts_at) do nothing;
    v_made := v_made + 1;
    v_start := v_start + interval '7 days';
  end loop;
  return v_made;
end;
$$;

-- Active Admin or Responder: who can be on call (D-007 roles).
create function private.oncall_eligible(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p
                 where p.id = p_user and p.is_active and p.role in ('admin', 'responder'));
$$;

-- ── The Admin's rotation ─────────────────────────────────────────────────
-- The order people take their weeks in. Weeks already scheduled keep their person; the weeks after
-- them follow the new order. Each person gets a message (B2) with their new weeks.
create function public.save_oncall_rotation(p_user_ids uuid[], p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb;
  v_u uuid;
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can change the rotation' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_user_ids), 0) = 0 then
    raise exception 'Add at least one person to the rotation' using errcode = '22023', hint = 'rotation_empty';
  end if;
  if (select count(distinct u) from unnest(p_user_ids) u) <> cardinality(p_user_ids) then
    raise exception 'Each person can be in the rotation once' using errcode = '22023', hint = 'rotation_duplicate';
  end if;
  foreach v_u in array p_user_ids loop
    if not private.oncall_eligible(v_u) then
      raise exception 'Only active Admins and Responders can be on call' using errcode = '22023', hint = 'rotation_person';
    end if;
  end loop;

  select coalesce(jsonb_agg(user_id order by position), '[]'::jsonb) into v_before from public.oncall_rotation;
  delete from public.oncall_rotation;
  insert into public.oncall_rotation (user_id, position)
  select u, o::smallint from unnest(p_user_ids) with ordinality as t(u, o);

  insert into public.audit_log (actor_id, action, entity, before, after)
  values (auth.uid(), 'oncall.rotation', 'oncall_rotation', jsonb_build_object('order', v_before),
          jsonb_build_object('order', to_jsonb(p_user_ids), 'note', nullif(btrim(coalesce(p_note, '')), '')));
  perform private.oncall_event('rotation_changed', null, null, null, jsonb_build_object('order', to_jsonb(p_user_ids)));
  perform public.oncall_extend_shifts(now() + interval '28 days');
end;
$$;

-- ── Swaps (§27, D-048 item 4) ─────────────────────────────────────────────
-- Asked by the person whose week it is, for another person's future week.
create function public.request_oncall_swap(p_shift_id uuid, p_with_shift_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.oncall_shifts%rowtype;
  v_b public.oncall_shifts%rowtype;
  v_id uuid;
begin
  select * into v_a from public.oncall_shifts where id = p_shift_id for update;
  select * into v_b from public.oncall_shifts where id = p_with_shift_id for update;
  if v_a.id is null or v_b.id is null then
    raise exception 'That week doesn''t exist any more' using errcode = 'P0002';
  end if;
  if v_a.user_id is distinct from auth.uid() then
    raise exception 'You can ask to swap only your own week' using errcode = '42501';
  end if;
  if v_a.user_id = v_b.user_id then
    raise exception 'Pick a week someone else has' using errcode = '22023', hint = 'swap_same_person';
  end if;
  -- The live shift can't be swapped: it's handed over instead (OnCall board).
  if v_a.starts_at <= now() or v_b.starts_at <= now() then
    raise exception 'The live shift can’t be swapped — hand it over in Users' using errcode = '22023', hint = 'swap_live';
  end if;
  if exists (select 1 from public.oncall_swaps s where s.status in ('waiting', 'accepted')
             and (s.requester_shift_id in (v_a.id, v_b.id) or s.counterpart_shift_id in (v_a.id, v_b.id))) then
    raise exception 'A swap is already waiting' using errcode = '22023', hint = 'swap_open';
  end if;
  insert into public.oncall_swaps (requester_shift_id, counterpart_shift_id, requester_id, counterpart_id, reason)
  values (v_a.id, v_b.id, v_a.user_id, v_b.user_id, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'oncall.swap_request', 'oncall_swap', v_id,
          jsonb_build_object('shift', v_a.id, 'with', v_b.id, 'counterpart', v_b.user_id));
  perform private.oncall_event('swap_requested', v_b.user_id, v_id, v_a.id);
  return v_id;
end;
$$;

-- The person asked accepts or declines (their reason is optional, §27.4).
create function public.respond_oncall_swap(p_swap_id uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.oncall_swaps%rowtype;
begin
  select * into v from public.oncall_swaps where id = p_swap_id for update;
  if not found then
    raise exception 'That request doesn''t exist any more' using errcode = 'P0002';
  end if;
  if v.counterpart_id is distinct from auth.uid() then
    raise exception 'Only the person asked can answer this request' using errcode = '42501';
  end if;
  if v.status <> 'waiting' then
    raise exception 'This request is closed' using errcode = '55000', hint = 'swap_closed';
  end if;
  update public.oncall_swaps
    set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now(),
        response_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = v.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case when p_accept then 'oncall.swap_accept' else 'oncall.swap_decline' end,
          'oncall_swap', v.id, jsonb_build_object('status', v.status),
          jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end, 'note', nullif(btrim(coalesce(p_note, '')), '')));
  perform private.oncall_event(case when p_accept then 'swap_accepted' else 'swap_declined' end,
                               v.requester_id, v.id, v.requester_shift_id);
end;
$$;

-- An Admin approves (once the person asked accepted — the weeks swap) or declines (reason required).
create function public.decide_oncall_swap(p_swap_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.oncall_swaps%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can approve or decline a swap' using errcode = '42501';
  end if;
  select * into v from public.oncall_swaps where id = p_swap_id for update;
  if not found then
    raise exception 'That request doesn''t exist any more' using errcode = 'P0002';
  end if;
  if v.status not in ('waiting', 'accepted') then
    raise exception 'This request is closed' using errcode = '55000', hint = 'swap_closed';
  end if;
  if p_approve and v.status <> 'accepted' then
    raise exception 'Approve unlocks once the person asked accepts' using errcode = '55000', hint = 'swap_not_accepted';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Say why — both of them see this' using errcode = '22023', hint = 'swap_reason';
  end if;
  if p_approve then
    if exists (select 1 from public.oncall_shifts where id in (v.requester_shift_id, v.counterpart_shift_id)
               and starts_at <= now()) then
      raise exception 'The live shift can’t be swapped — hand it over in Users' using errcode = '22023', hint = 'swap_live';
    end if;
    update public.oncall_shifts set user_id = v.counterpart_id where id = v.requester_shift_id;
    update public.oncall_shifts set user_id = v.requester_id where id = v.counterpart_shift_id;
  end if;
  update public.oncall_swaps
    set status = case when p_approve then 'approved' else 'admin_declined' end,
        decided_by = auth.uid(), decided_at = now(), decision_note = v_note
    where id = v.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), case when p_approve then 'oncall.swap_approve' else 'oncall.swap_admin_decline' end,
          'oncall_swap', v.id, jsonb_build_object('status', v.status),
          jsonb_build_object('status', case when p_approve then 'approved' else 'admin_declined' end, 'note', v_note));
  perform private.oncall_event(case when p_approve then 'swap_approved' else 'swap_admin_declined' end,
                               null, v.id, v.requester_shift_id);
end;
$$;

-- The requester takes it back while it's open (§27.6).
create function public.withdraw_oncall_swap(p_swap_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.oncall_swaps%rowtype;
begin
  select * into v from public.oncall_swaps where id = p_swap_id for update;
  if not found then
    raise exception 'That request doesn''t exist any more' using errcode = 'P0002';
  end if;
  if v.requester_id is distinct from auth.uid() then
    raise exception 'Only the person who asked can withdraw it' using errcode = '42501';
  end if;
  if v.status not in ('waiting', 'accepted') then
    raise exception 'This request is closed' using errcode = '55000', hint = 'swap_closed';
  end if;
  update public.oncall_swaps set status = 'withdrawn', decided_at = now() where id = v.id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'oncall.swap_withdraw', 'oncall_swap', v.id, jsonb_build_object('status', v.status),
          jsonb_build_object('status', 'withdrawn'));
  perform private.oncall_event('swap_withdrawn', v.counterpart_id, v.id, v.requester_shift_id);
end;
$$;

-- ── Hand over a shift (Users board dialog, opened from On-call — D-048 item 5) ──
-- An Admin moves the rest of a shift (from `p_at`) to someone else, with a reason. A future shift is
-- reassigned whole; the live one is split at `p_at`.
create function public.hand_over_oncall_shift(p_shift_id uuid, p_to uuid, p_at timestamptz, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.oncall_shifts%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_at timestamptz := greatest(coalesce(p_at, now()), now());
  v_new uuid;
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can hand over a shift' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'Add a short reason — both of them see it' using errcode = '22023', hint = 'handover_reason';
  end if;
  if not private.oncall_eligible(p_to) then
    raise exception 'Only active Admins and Responders can be on call' using errcode = '22023', hint = 'rotation_person';
  end if;
  select * into v from public.oncall_shifts where id = p_shift_id for update;
  if not found then
    raise exception 'That week doesn''t exist any more' using errcode = 'P0002';
  end if;
  if v.user_id = p_to then
    raise exception 'Pick someone else' using errcode = '22023', hint = 'handover_same';
  end if;
  if v_at >= v.ends_at then
    raise exception 'That shift is over' using errcode = '22023', hint = 'handover_over';
  end if;
  -- An open swap on this week can't go through any more.
  update public.oncall_swaps set status = 'admin_declined', decided_by = auth.uid(), decided_at = now(),
         decision_note = 'The week was handed over'
    where status in ('waiting', 'accepted') and (requester_shift_id = v.id or counterpart_shift_id = v.id);
  if v_at <= v.starts_at then
    update public.oncall_shifts set user_id = p_to, handed_over_from = v.user_id, handover_reason = v_reason
      where id = v.id;
    v_new := v.id;
  else
    update public.oncall_shifts set ends_at = v_at where id = v.id;
    insert into public.oncall_shifts (user_id, starts_at, ends_at, handed_over_from, handover_reason)
    values (p_to, v_at, v.ends_at, v.user_id, v_reason)
    returning id into v_new;
  end if;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'oncall.handover', 'oncall_shift', v.id,
          jsonb_build_object('user', v.user_id, 'starts', v.starts_at, 'ends', v.ends_at),
          jsonb_build_object('user', p_to, 'from', v_at, 'reason', v_reason));
  perform private.oncall_event('handed_over', p_to, null, v_new,
                               jsonb_build_object('from', v.user_id, 'at', v_at, 'reason', v_reason));
  return v_new;
end;
$$;

-- ── The phone checklist and the test alert (§10, §27.8) ──────────────────
create function public.set_oncall_checklist(p_mentions_only boolean, p_dnd_allowed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_staff() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  insert into public.oncall_checklist (user_id, mentions_only, dnd_allowed)
  values (auth.uid(), p_mentions_only, p_dnd_allowed)
  on conflict (user_id) do update set mentions_only = excluded.mentions_only, dnd_allowed = excluded.dnd_allowed;
end;
$$;

-- "Send test alert to me": a fresh link token; the earlier receipt no longer counts (a new phone).
create function public.send_oncall_test()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  insert into public.oncall_checklist (user_id, test_sent_at, test_token, test_received_at)
  values (auth.uid(), v_at, gen_random_uuid(), null)
  on conflict (user_id) do update set test_sent_at = v_at, test_token = gen_random_uuid(), test_received_at = null;
  perform private.oncall_event('test_alert', auth.uid(), null, null);
  return v_at;
end;
$$;

-- The test link opened: only the person it was for ticks it (§27.8 "This test was for Ploy").
create function public.confirm_oncall_test(p_token uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.oncall_checklist%rowtype;
  v_name text;
begin
  select * into v from public.oncall_checklist where test_token = p_token for update;
  if not found then
    raise exception 'This test link has expired — send a new test alert' using errcode = 'P0002';
  end if;
  if v.user_id is distinct from auth.uid() then
    select display_name into v_name from public.profiles where id = v.user_id;
    raise exception 'This test was for % — open it on %’s phone.', v_name, v_name
      using errcode = '42501', hint = 'test_other_person';
  end if;
  if v.test_received_at is null then
    update public.oncall_checklist set test_received_at = now() where id = v.id returning * into v;
  end if;
  return v.test_received_at;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────────
revoke execute on function
  public.oncall_week_start(timestamptz),
  public.oncall_person_at(timestamptz),
  private.oncall_event(text, uuid, uuid, uuid, jsonb),
  public.oncall_extend_shifts(timestamptz),
  private.oncall_eligible(uuid),
  public.save_oncall_rotation(uuid[], text),
  public.request_oncall_swap(uuid, uuid, text),
  public.respond_oncall_swap(uuid, boolean, text),
  public.decide_oncall_swap(uuid, boolean, text),
  public.withdraw_oncall_swap(uuid),
  public.hand_over_oncall_shift(uuid, uuid, timestamptz, text),
  public.set_oncall_checklist(boolean, boolean),
  public.send_oncall_test(),
  public.confirm_oncall_test(uuid)
  from public, anon;
grant execute on function
  public.oncall_week_start(timestamptz),
  public.oncall_person_at(timestamptz),
  public.save_oncall_rotation(uuid[], text),
  public.request_oncall_swap(uuid, uuid, text),
  public.respond_oncall_swap(uuid, boolean, text),
  public.decide_oncall_swap(uuid, boolean, text),
  public.withdraw_oncall_swap(uuid),
  public.hand_over_oncall_shift(uuid, uuid, timestamptz, text),
  public.set_oncall_checklist(boolean, boolean),
  public.send_oncall_test(),
  public.confirm_oncall_test(uuid)
  to authenticated;
grant execute on function
  public.oncall_week_start(timestamptz),
  public.oncall_person_at(timestamptz),
  public.oncall_extend_shifts(timestamptz)
  to service_role;
