set local lock_timeout = '5s';

-- D-078 PR 3a (spec §43): the ladder token `management`. Bodies as their latest definitions
-- (20261029144512 escalation_people + save_escalation_policies, 20261103135910 engine_client_update_due,
-- 20261104075341 send_client_update_reminder, 20261128091534 set_management + its trigger) plus the
-- marked changes. No policy changes here: Tier 1 L2 is switched on the Escalation page (D-078 3e).

alter table public.escalation_steps drop constraint escalation_steps_targets_check;
alter table public.escalation_steps add constraint escalation_steps_targets_check
  check (targets <@ array['owner', 'backup', 'admins', 'management', 'site_am', 'ceo']);


create or replace function public.escalation_people(p_incident_id uuid, p_targets jsonb)
returns table (user_id uuid, token text, chat_user_id text)
language sql
stable
set search_path = ''
as $$
  select distinct on (x.uid) x.uid, x.token, p.google_chat_user_id
  from (
    -- "Owner / on-call" (S10): the L0 person frozen on the incident while active, else the owner.
    select coalesce(l.id, s.primary_owner_id) as uid, 'owner' as token, 1 as ord
      from public.incidents i join public.sites s on s.id = i.site_id
      left join public.profiles l on l.id = i.l0_user_id and l.is_active and l.role in ('admin', 'responder')
      where i.id = p_incident_id and p_targets ? 'owner'
    union all
    select s.backup_owner_id, 'backup', 2
      from public.incidents i join public.sites s on s.id = i.site_id
      where i.id = p_incident_id and p_targets ? 'backup'
    union all
    select c.am_user_id, 'site_am', 3
      from public.incidents i join public.sites s on s.id = i.site_id
      join public.clients c on c.id = s.client_id
      where i.id = p_incident_id and p_targets ? 'site_am'
    union all
    -- D-078 (3a): Management, the Admins tagged so (spec §43) — and the ladder's Admins are the others.
    select m.id, 'management', 4
      from public.profiles m
      where m.role = 'admin' and m.is_active and m.is_management and p_targets ? 'management'
    union all
    select a.id, 'admins', 5
      from public.profiles a
      where a.role = 'admin' and a.is_active and p_targets ? 'admins' and not a.is_management
    union all
    -- Not a policy token: every active Admin, Management too, for the client-update noAm mention (3a).
    select a.id, 'admins', 5
      from public.profiles a
      where a.role = 'admin' and a.is_active and p_targets ? 'every_admin'
    union all
    -- The CEO (D-032): a stakeholder who manages no client.
    select c.id, 'ceo', 6
      from public.profiles c
      where c.role = 'stakeholder' and c.is_active and p_targets ? 'ceo'
        and not exists (select 1 from public.clients k where k.am_user_id = c.id)
  ) x
  join public.profiles p on p.id = x.uid and p.is_active
  where x.uid is not null
  order by x.uid, x.ord;
$$;

create or replace function public.save_escalation_policies(
  p_policies jsonb,
  p_down_reminder_min integer,
  p_problem_reminder_min integer,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_before jsonb;
  v_after jsonb;
  v_pol jsonb;
  v_policy public.escalation_policies%rowtype;
  v_step jsonb;
  v_level integer;
  v_prev integer;
  v_count integer;
  v_targets text[];
  v_channels text[];
  v_delay integer;
  v_is_fyi boolean;
  v_t1_down boolean;
  v_fyi_level integer;
begin
  if coalesce(public.current_app_role() = 'admin', false) is not true then
    raise exception 'Only an Admin can change escalation policies' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'Add a short note — it goes in the audit log with the change'
      using errcode = '22023', hint = 'note_required';
  end if;
  if length(v_note) > 500 then
    raise exception 'The note is too long' using errcode = '22023', hint = 'note_too_long';
  end if;
  if p_down_reminder_min is null or p_down_reminder_min not between 1 and 1440
     or p_problem_reminder_min is null or p_problem_reminder_min not between 1 and 1440 then
    raise exception 'Whole minutes above 0, e.g. 15' using errcode = '22023', hint = 'reminder_invalid';
  end if;
  if jsonb_typeof(p_policies) is distinct from 'array' then
    raise exception 'Nothing to save' using errcode = '22023', hint = 'invalid';
  end if;

  -- One save at a time, so the audit row's "before" is what this save changed.
  perform 1 from public.organisation_settings where singleton for update;

  select jsonb_build_object(
    'policies', (select jsonb_agg(jsonb_build_object('severity', p.severity, 'tier', p.tier,
                   'steps', (select jsonb_agg(jsonb_build_object('level', s.level, 'delayMin', s.delay_min,
                                'targets', s.targets, 'channels', s.channels, 'fyi', s.fyi) order by s.level)
                             from public.escalation_steps s where s.policy_id = p.id))
                 order by p.severity, p.tier)
                 from public.escalation_policies p),
    'downReminderMin', o.down_reminder_min, 'problemReminderMin', o.problem_reminder_min)
    into v_before
  from public.organisation_settings o;

  for v_pol in select * from jsonb_array_elements(p_policies) loop
    select * into v_policy from public.escalation_policies where id = (v_pol ->> 'policyId')::uuid for update;
    if not found then
      raise exception 'Policy not found' using errcode = 'P0002';
    end if;
    v_t1_down := v_policy.severity = 'down' and v_policy.tier = 1;

    v_prev := null;
    v_count := 0;
    v_fyi_level := null;
    for v_step in
      select s from jsonb_array_elements(v_pol -> 'steps') s order by (s ->> 'level')::integer
    loop
      if jsonb_typeof(v_step -> 'level') is distinct from 'number'
         or jsonb_typeof(v_step -> 'delayMin') is distinct from 'number'
         or jsonb_typeof(v_step -> 'targets') is distinct from 'array'
         or jsonb_typeof(v_step -> 'channels') is distinct from 'array'
         or jsonb_typeof(coalesce(nullif(v_step -> 'fyi', 'null'::jsonb), 'false'::jsonb)) is distinct from 'boolean' then
        raise exception 'A step is missing its delay, people or channels' using errcode = '22023', hint = 'invalid';
      end if;
      v_level := (v_step ->> 'level')::integer;
      v_delay := (v_step ->> 'delayMin')::integer;
      v_targets := array(select jsonb_array_elements_text(v_step -> 'targets'));
      v_channels := array(select jsonb_array_elements_text(v_step -> 'channels'));
      v_is_fyi := coalesce((v_step ->> 'fyi')::boolean, false);
      if v_level is distinct from v_count then
        raise exception 'Steps must run L0, L1, … in order' using errcode = '22023', hint = 'levels';
      end if;
      if v_level > 3 then
        raise exception 'At most four steps, L0–L3' using errcode = '22023', hint = 'too_many_steps';
      end if;
      if not (v_targets <@ array['owner', 'backup', 'admins', 'management', 'site_am', 'ceo']
              and v_channels <@ array['chat', 'space', 'email', 'voice']) then
        raise exception 'Unknown person or channel' using errcode = '22023', hint = 'invalid';
      end if;
      -- L0 goes at once to the owner / on-call by Chat @mention and the Alerts Space (locked, spec §14.7);
      -- the pencil adds people and email (S10, D-034). engine_open_incident tells everyone it names.
      if v_level = 0 and not (v_delay = 0 and 'owner' = any (v_targets) and not v_is_fyi
                              and v_channels @> array['chat', 'space']
                              and v_channels <@ array['chat', 'space', 'email']) then
        raise exception 'L0 is pinned on every policy' using errcode = '22023', hint = 'l0_pinned';
      end if;
      if v_delay > 10080 then
        raise exception 'At most a week (10080 min)' using errcode = '22023', hint = 'step_too_late';
      end if;
      if cardinality(array_remove(v_channels, 'voice')) = 0 then
        raise exception 'No channel ticked — this step notifies nobody.' using errcode = '22023', hint = 'no_channel';
      end if;
      if cardinality(v_targets) = 0 then
        raise exception 'Pick at least one person.' using errcode = '22023', hint = 'no_person';
      end if;
      if v_level > 0 and (v_delay is null or v_delay < 15) then
        raise exception 'Must be at least +15 min.' using errcode = '22023', hint = 'step_too_early';
      end if;
      if v_level > 0 and v_delay <= v_prev then
        raise exception 'Must be later than L% (+% min).', v_level - 1, v_prev
          using errcode = '22023', hint = 'step_not_later';
      end if;
      -- The CEO is paged only on Tier 1 DOWN, from L2 onward (§15.5, D-009).
      if 'ceo' = any (v_targets) and not v_t1_down then
        raise exception 'The CEO is paged only on Tier 1 DOWN — remove CEO from this step.'
          using errcode = '22023', hint = 'ceo_not_allowed';
      end if;
      if 'ceo' = any (v_targets) and v_level < 2 then
        raise exception 'The CEO can be paged only from L2 onward.' using errcode = '22023', hint = 'ceo_too_early';
      end if;
      -- D-078 (spec §43.9): Management only on Tier 1 DOWN, from L2, never with voice, and someone to tell.
      if 'management' = any (v_targets) and not v_t1_down then
        raise exception 'Management is used only on Tier 1 DOWN' using errcode = '22023', hint = 'management_not_allowed';
      end if;
      if 'management' = any (v_targets) and v_level < 2 then
        raise exception 'Management can be told only from L2' using errcode = '22023', hint = 'management_too_early';
      end if;
      if 'management' = any (v_targets) and 'voice' = any (v_channels) then
        raise exception 'No voice on a Management step — they''re told by Chat @mention + email.'
          using errcode = '22023', hint = 'voice_not_here';
      end if;
      if 'management' = any (v_targets) and not exists (
        select 1 from public.profiles m
        where m.is_management and m.is_active and m.role = 'admin'
          and nullif(btrim(m.google_chat_user_id), '') is not null) then
        raise exception 'Nobody is Management yet — set someone on Users & roles'
          using errcode = '22023', hint = 'nobody_management';
      end if;
      -- Voice: configured on the Tier 1 CEO step, off until approved; never on the FYI step.
      if 'voice' = any (v_channels) and (v_is_fyi or not ('ceo' = any (v_targets)) or not v_t1_down) then
        raise exception 'Only the L2 CEO step can carry a voice call, and it stays off until approved.'
          using errcode = '22023', hint = 'voice_not_here';
      end if;
      if v_is_fyi then
        if not v_t1_down or v_fyi_level is not null then
          raise exception 'Only Tier 1 DOWN has the CEO + AM FYI step' using errcode = '22023', hint = 'invalid';
        end if;
        if not (v_targets @> array['ceo', 'site_am']) then
          raise exception 'CEO + Site AM are fixed on this step: it’s the Tier 1 step that still sends an FYI after acknowledge (never a call). It can’t be removed.'
            using errcode = '22023', hint = 'fyi_people';
        end if;
        v_fyi_level := v_level;
      end if;
      v_prev := v_delay;
      v_count := v_count + 1;
    end loop;

    if v_count = 0 then
      raise exception 'L0 is pinned on every policy' using errcode = '22023', hint = 'l0_pinned';
    end if;
    if v_t1_down and v_fyi_level is null then
      raise exception 'The CEO + AM FYI step can’t be removed from Tier 1 DOWN'
        using errcode = '22023', hint = 'fyi_required';
    end if;
    -- A step after L0 that isn't the FYI: otherwise nobody is asked to acknowledge after the owner.
    if v_policy.severity = 'down' and v_count - (case when v_fyi_level is null then 0 else 1 end) < 2 then
      raise exception '% needs at least one step after L0 — otherwise nobody else is ever told.',
        'Tier ' || v_policy.tier || ' DOWN' using errcode = '22023', hint = 'down_needs_step';
    end if;

    delete from public.escalation_steps where policy_id = v_policy.id;
    insert into public.escalation_steps (policy_id, level, delay_min, targets, channels, fyi)
    select v_policy.id, (s ->> 'level')::smallint, (s ->> 'delayMin')::integer,
           array(select jsonb_array_elements_text(s -> 'targets')),
           array(select jsonb_array_elements_text(s -> 'channels')),
           coalesce((s ->> 'fyi')::boolean, false)
    from jsonb_array_elements(v_pol -> 'steps') s;
    update public.escalation_policies set updated_at = now() where id = v_policy.id;
  end loop;

  update public.organisation_settings
    set down_reminder_min = p_down_reminder_min, problem_reminder_min = p_problem_reminder_min
    where singleton
      and (down_reminder_min, problem_reminder_min) is distinct from (p_down_reminder_min, p_problem_reminder_min);

  select jsonb_build_object(
    'policies', (select jsonb_agg(jsonb_build_object('severity', p.severity, 'tier', p.tier,
                   'steps', (select jsonb_agg(jsonb_build_object('level', s.level, 'delayMin', s.delay_min,
                                'targets', s.targets, 'channels', s.channels, 'fyi', s.fyi) order by s.level)
                             from public.escalation_steps s where s.policy_id = p.id))
                 order by p.severity, p.tier)
                 from public.escalation_policies p),
    'downReminderMin', o.down_reminder_min, 'problemReminderMin', o.problem_reminder_min)
    into v_after
  from public.organisation_settings o;

  if v_after is distinct from v_before then
    insert into public.audit_log (actor_id, action, entity, before, after)
    values (auth.uid(), 'escalation.update', 'escalation', v_before,
            v_after || jsonb_build_object('note', v_note));
  end if;
end;
$$;

create or replace function public.engine_client_update_due(
  p_incident_id uuid,
  p_due_at timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_tier smallint;
  v_internal boolean;
  v_people uuid[];
  v_am uuid;
  v_am_name text;
  v_payload jsonb;
  v_no_am boolean;
  v_at timestamptz;
begin
  if p_due_at is null or p_due_at > now() then
    return false;
  end if;
  -- Cheap answers before the lock: the runner asks every minute until it fires (db review M1).
  -- Re-checked under the lock below.
  perform 1 from public.incidents
  where id = p_incident_id and not client_update_required and severity = 'down'
    and state not in ('resolved', 'in_review', 'closed');
  if not found then
    return false;
  end if;

  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.client_update_required then
    return false;
  end if;
  -- A DOWN incident that is still open. Recovered is fine when the recovery came at or after the due
  -- time: the runner fires it when a DOWN drop covered the due time, and a recovery in that same
  -- minute may have been judged first. Recovered before it was due: never (db review M3).
  if v_inc.severity <> 'down' or v_inc.state in ('resolved', 'in_review', 'closed') then
    return false;
  end if;
  if v_inc.state in ('monitoring', 'needs_root_cause') and v_inc.recovered_at < p_due_at then
    return false;
  end if;
  -- Never earlier than 15 DOWN minutes after the first failed check (engine review L6). The runner's
  -- time is a JS Date (milliseconds); a started_at written by SQL has microseconds (db review M1).
  if p_due_at < date_trunc('milliseconds', v_inc.started_at) + interval '15 minutes' then
    return false;
  end if;

  select s.tier, c.is_internal, c.am_user_id into v_tier, v_internal, v_am
  from public.sites s join public.clients c on c.id = s.client_id
  where s.id = v_inc.site_id;
  -- Tier 3 goes to the report only; an internal client has nobody to tell (§9).
  if v_tier not in (1, 2) or v_internal then
    return false;
  end if;

  -- The thread needs its DOWN alert (as engine_fire_step): an incident on a site muted before it
  -- opened waits for its late alert, one alerted before the mute keeps its track (§15.1, T09). Any
  -- drop's DOWN / DOWN AGAIN counts, not only the current drop's: a PROBLEM AGAIN held outside
  -- response hours doesn't hold the track back (engine review L5).
  if not exists (
    select 1 from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'google_chat'
      and n.template in ('down', 'down_again')
      and (n.status <> 'cancelled' or n.attempts > 0)
      and (n.hold_until is null or n.hold_until <= now())
  ) then
    return false;
  end if;

  -- The client's AM while active; otherwise every active Admin (D-052 item 2).
  select coalesce(array_agg(pe.user_id), '{}') into v_people
  from public.escalation_people(p_incident_id, '["site_am"]'::jsonb) pe;
  v_no_am := cardinality(v_people) = 0;
  if v_no_am then
    select coalesce(array_agg(pe.user_id), '{}') into v_people
    from public.escalation_people(p_incident_id, '["every_admin"]'::jsonb) pe;
  else
    select display_name into v_am_name from public.profiles where id = v_am;
  end if;

  update public.incidents
    set client_update_required = true, client_update_due_at = p_due_at
    where id = p_incident_id;

  v_payload := jsonb_build_object(
    'dueAt', p_due_at, 'tier', v_tier, 'minutes', case when v_tier = 1 then 15 else 60 end,
    'am', v_am_name, 'noAm', v_no_am, 'notified', to_jsonb(v_people),
    'mentioned', to_jsonb(v_people));

  -- The timeline shows when it fell due (10:03:12), not the run that noticed — but never before the
  -- thread's first alert: an incident a mute silenced gets its track once its late alert went
  -- (`alerted_at`, db review M2).
  v_at := greatest(p_due_at, coalesce(v_inc.alerted_at, p_due_at));
  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'client_update_due', v_payload, v_at);

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.client_update_due', 'incident', p_incident_id,
          jsonb_build_object('client_update_required', false),
          jsonb_build_object('client_update_required', true, 'client_update_due_at', p_due_at,
                             'notified', to_jsonb(v_people)));

  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  values (p_incident_id, 'google_chat', 'client_update_due', p_incident_id::text,
          p_context || v_payload, 'client_update')
  on conflict do nothing;

  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
  select p_incident_id, u, 'email', 'client_update_due', p_incident_id::text,
         p_context || v_payload, 'client_update'
  from unnest(v_people) u
  on conflict do nothing;

  -- Recovered already (the same minute): engine_recover_incident emailed RECOVERED to everyone emailed
  -- so far, before these people had a row. They get this recovery's email too, with its Chat reply's
  -- context and key, stamped after the client-update email so it goes second (D-052 item 7). A held
  -- flap summary has no RECOVERED reply, so nothing follows (it emails L0 only, D-039). Only a DOWN
  -- drop's recovery: a PROBLEM drop's RECOVERED emails only who was emailed about it (D-038). The
  -- reply is this drop's when queued since the drop began — the latest relapse's audit row, the
  -- database clock like created_at (recovered_at is the probe's, db review L1).
  if v_inc.state in ('monitoring', 'needs_root_cause')
     and coalesce(v_inc.episode_severity, v_inc.severity) = 'down' then
    insert into public.notifications
      (incident_id, user_id, channel, template, thread_key, context, dedupe_key, created_at)
    select p_incident_id, u, 'email', 'recovered', p_incident_id::text, r.context, r.dedupe_key,
           clock_timestamp()
    from unnest(v_people) u
    cross join lateral (
      select n.context, n.dedupe_key from public.notifications n
      where n.incident_id = p_incident_id and n.channel = 'google_chat' and n.template = 'recovered'
        and n.status <> 'cancelled'
        and n.created_at >= coalesce(
          (select max(a.at) from public.audit_log a
           where a.entity = 'incident' and a.entity_id = p_incident_id and a.action = 'incident.relapsed'),
          '-infinity')
      order by n.created_at desc
      limit 1
    ) r
    on conflict do nothing;
  end if;

  return true;
end;
$$;

create or replace function public.send_client_update_reminder(p_incident_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_tier smallint;
  v_internal boolean;
  v_am uuid;
  v_am_name text;
  v_people uuid[];
  v_no_am boolean;
  v_due timestamptz;
  v_actor text;
  v_payload jsonb;
begin
  v_inc := private.by_hand_incident(p_incident_id);
  if v_inc.client_update_required then
    raise exception 'the reminder went already' using errcode = '55000', hint = 'already_sent';
  end if;
  -- Down now: a recovered incident waits for the engine's track, which knows whether it fell due (db M2).
  if v_inc.severity <> 'down' or v_inc.state not in ('unacked', 'escalated', 'acknowledged') then
    raise exception 'only an incident that is down now' using errcode = '55000', hint = 'not_down';
  end if;

  select s.tier, c.is_internal, c.am_user_id into v_tier, v_internal, v_am
  from public.sites s join public.clients c on c.id = s.client_id
  where s.id = v_inc.site_id;
  if v_tier not in (1, 2) or v_internal then
    raise exception 'no client update for this site' using errcode = '55000', hint = 'no_track';
  end if;
  -- The thread needs its DOWN alert, as the engine's track.
  if not exists (
    select 1 from public.notifications n
    where n.incident_id = p_incident_id and n.channel = 'google_chat'
      and n.template in ('down', 'down_again')
      and (n.status <> 'cancelled' or n.attempts > 0)
      and (n.hold_until is null or n.hold_until <= now())
  ) then
    raise exception 'the DOWN alert hasn''t gone yet' using errcode = '55000', hint = 'no_thread';
  end if;

  select coalesce(array_agg(pe.user_id), '{}') into v_people
  from public.escalation_people(p_incident_id, '["site_am"]'::jsonb) pe;
  v_no_am := cardinality(v_people) = 0;
  if v_no_am then
    select coalesce(array_agg(pe.user_id), '{}') into v_people
    from public.escalation_people(p_incident_id, '["every_admin"]'::jsonb) pe;
  else
    select display_name into v_am_name from public.profiles where id = v_am;
  end if;
  select display_name into v_actor from public.profiles where id = auth.uid();

  v_due := case when v_tier = 1 then date_trunc('milliseconds', v_inc.started_at) + interval '15 minutes'
                else now() end;
  update public.incidents
    set client_update_required = true, client_update_due_at = v_due
    where id = p_incident_id;

  v_payload := jsonb_build_object(
    'dueAt', v_due, 'tier', v_tier, 'minutes', case when v_tier = 1 then 15 else 60 end,
    'am', v_am_name, 'noAm', v_no_am, 'notified', to_jsonb(v_people), 'mentioned', to_jsonb(v_people),
    'byHand', true, 'sentBy', v_actor);

  insert into public.incident_events (incident_id, type, actor_id, payload, at)
  values (p_incident_id, 'client_update_due', auth.uid(), v_payload, now());

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'incident.client_update_due', 'incident', p_incident_id,
          jsonb_build_object('client_update_required', false),
          jsonb_build_object('client_update_required', true, 'client_update_due_at', v_due,
                             'notified', to_jsonb(v_people), 'by_hand', true));

  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  values (p_incident_id, 'google_chat', 'client_update_due', p_incident_id::text, v_payload, 'client_update')
  on conflict do nothing;
  insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
  select p_incident_id, u, 'email', 'client_update_due', p_incident_id::text, v_payload, 'client_update'
  from unnest(v_people) u
  on conflict do nothing;
  return true;
end;
$$;

-- The last active Management person can't go while a step names Management: that step would tell
-- nobody (spec §43.5). Used by set_management (remove) and the role / deactivate trigger.
create function private.assert_management_left(p_user uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One at a time with save_escalation_policies (security review M1): it locks this row first, so a
  -- save of a Management step and the removal of the last Management person can't both commit. Taken
  -- after user_access and the profile row (the people path's order), never the other way round.
  perform 1 from public.organisation_settings where singleton for update;
  -- a policy step, or an open incident's frozen plan (db review M2), that names Management
  if (exists (select 1 from public.escalation_steps st where 'management' = any (st.targets))
      or exists (select 1 from public.incidents i
                 where i.state not in ('resolved', 'in_review', 'closed')
                   and i.escalation_plan @? '$.steps[*].targets[*] ? (@ == "management")'))
     and not exists (select 1 from public.profiles m
                     where m.is_management and m.is_active and m.role = 'admin' and m.id <> p_user) then
    raise exception 'Can''t remove: Tier 1 DOWN L2 goes to Management and % is the last one. Change the L2 step on Escalation first, or set someone else as Management.', p_name
      using errcode = '55000', hint = 'last_management';
  end if;
end;
$$;
revoke execute on function private.assert_management_left(uuid, text) from public, anon, authenticated;

create or replace function private.management_follows_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_management and (new.role <> 'admin' or not new.is_active) then
    perform private.assert_management_left(old.id, old.display_name);
    new.is_management := false;
    insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
    values (auth.uid(), 'user.management', 'user', new.id, jsonb_build_object('management', true),
            jsonb_build_object('management', false,
              'reason', case when not new.is_active then 'deactivated' else 'role changed' end));
  end if;
  return new;
end;
$$;

create or replace function public.set_management(p_user_id uuid, p_on boolean, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.profiles%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  -- one change to people at a time (S16 review M1); no on-call row is touched
  perform private.lock_people('Only an Admin can set who is Management', false);
  if p_on is null then
    raise exception 'Say whether to set or remove' using errcode = '22023';
  end if;
  if v_note is null then
    raise exception 'Add a short note — it goes in the audit log' using errcode = '22023', hint = 'note_required';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '22023', hint = 'note_too_long';
  end if;
  select * into v from public.profiles where id = p_user_id for update;
  if not found or not v.is_active then
    raise exception 'That person doesn''t have access any more' using errcode = 'P0002';
  end if;
  if v.is_management = p_on then
    return;
  end if;
  if p_on and v.role <> 'admin' then
    raise exception 'Only Admins can be Management' using errcode = '55000', hint = 'not_admin';
  end if;
  if p_on and nullif(btrim(v.google_chat_user_id), '') is null then
    raise exception 'Add a Google Chat id first — Management is @mentioned'
      using errcode = '55000', hint = 'needs_chat';
  end if;

  if not p_on then
    perform private.assert_management_left(v.id, v.display_name);
  end if;
  update public.profiles set is_management = p_on where id = p_user_id;
  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), 'user.management', 'user', p_user_id, jsonb_build_object('management', not p_on),
          jsonb_build_object('management', p_on, 'note', v_note));

  -- One email, to the person only (§34, D-078 item 3c).
  insert into public.account_events (kind, user_id, actor_id, from_role, to_role, facts)
  values (case when p_on then 'management_set' else 'management_removed' end, v.id, auth.uid(), v.role, v.role,
          jsonb_build_object('actor', (select a.display_name from public.profiles a where a.id = auth.uid()),
            'others', (select coalesce(jsonb_agg(m.display_name order by m.display_name), '[]'::jsonb)
                       from public.profiles m
                       where m.is_management and m.is_active and m.id <> v.id)))
  returning id into v_id;
  insert into public.notifications (account_event_id, channel, template, user_id, thread_key)
  values (v_id, 'email', 'account_email', v.id, 'account-' || v_id);
end;
$$;
