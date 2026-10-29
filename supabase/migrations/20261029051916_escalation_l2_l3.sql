-- S10 · Escalation L2–L3 (FR-09b; spec §8, §14.1, §14.7, §15.5, §16.5; D-009, D-034, D-048).
--   · Tier 1 DOWN: L2 +30 the CEO (Chat @mention + email; voice configured, never sent — off until
--     approved), L3 +60 CEO + Site AM as an FYI that still goes after an acknowledgement while the site
--     is DOWN, never a call. Tier 2–3 DOWN: L2 +30 a reminder to the Admin (Chat + email, no CEO).
--   · `escalation_steps.fyi` marks the FYI step; it rides along in the plan an incident keeps.
--   · The `ceo` token: every active stakeholder who manages no client (D-032).
--   · engine_fire_step: an FYI step fires while Acknowledged too and tells everyone it names; a step
--     whose people were all told already reminds them (REMINDER · L2 to Tao, §16.5) without marking
--     the incident Escalated. An ack leaves a queued FYI alone.
--   · save_escalation_policies: L2–L3, the CEO, voice and the FYI step's guardrails (§14.7, §15.5).

-- ── The FYI step ────────────────────────────────────────────────────────────
alter table public.escalation_steps add column fyi boolean not null default false;
comment on column public.escalation_steps.fyi is
  'The Tier 1 CEO + Site AM step: still sent after an ack while DOWN, as an FYI, never a call (spec §15.5)';

-- ── Seeds: L2–L3 on the DOWN policies (spec §8) ─────────────────────────────
insert into public.escalation_steps (policy_id, level, delay_min, targets, channels, fyi)
select p.id, s.level, s.delay_min, s.targets, s.channels, s.fyi
from public.escalation_policies p
cross join lateral (
  values
    (2::smallint, 30, array['ceo'], array['chat', 'email', 'voice'], false, 1),
    (3::smallint, 60, array['ceo', 'site_am'], array['chat', 'email'], true, 1),
    (2::smallint, 30, array['admins'], array['chat', 'email'], false, 2),
    (2::smallint, 30, array['admins'], array['chat', 'email'], false, 3)
) as s (level, delay_min, targets, channels, fyi, tier)
where p.severity = 'down' and p.tier = s.tier
on conflict (policy_id, level) do nothing;

-- ── The plan an incident keeps: the FYI flag rides along ────────────────────
create or replace function public.escalation_plan_for(p_tier smallint, p_severity public.severity)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'severity', p.severity,
    'tier', p_tier,
    'reminderMin', case when p.severity = 'down' then o.down_reminder_min else o.problem_reminder_min end,
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object('level', s.level, 'delayMin', s.delay_min,
                                          'targets', to_jsonb(s.targets), 'channels', to_jsonb(s.channels))
                       || case when s.fyi then '{"fyi": true}'::jsonb else '{}'::jsonb end
                       order by s.level)
      from public.escalation_steps s where s.policy_id = p.id), '[]'::jsonb))
  from public.escalation_policies p
  cross join public.organisation_settings o
  where p.severity = p_severity and (p.tier = p_tier or (p_severity = 'problem' and p.tier is null));
$$;

-- ── The people a token names: + the CEO ─────────────────────────────────────
create or replace function public.escalation_people(p_incident_id uuid, p_targets jsonb)
returns table (user_id uuid, token text, chat_user_id text)
language sql
stable
set search_path = ''
as $$
  select distinct on (x.uid) x.uid, x.token, p.google_chat_user_id
  from (
    select s.primary_owner_id as uid, 'owner' as token, 1 as ord
      from public.incidents i join public.sites s on s.id = i.site_id
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
    select a.id, 'admins', 4
      from public.profiles a
      where a.role = 'admin' and a.is_active and p_targets ? 'admins'
    union all
    -- The CEO (D-032): a stakeholder who manages no client.
    select c.id, 'ceo', 5
      from public.profiles c
      where c.role = 'stakeholder' and c.is_active and p_targets ? 'ceo'
        and not exists (select 1 from public.clients k where k.am_user_id = c.id)
  ) x
  join public.profiles p on p.id = x.uid and p.is_active
  where x.uid is not null
  order by x.uid, x.ord;
$$;

-- ── An ack leaves a queued FYI alone ────────────────────────────────────────
-- The FYI step is due at +60 whatever happened (§14.1): one claimed just before the ack still goes;
-- a recovery, D-021 or a resolve still sets it aside.
create or replace function public.engine_cancel_ladder(p_incident_id uuid, p_reason text)
returns integer
language sql
set search_path = ''
as $$
  with c as (
    update public.notifications n
      set status = 'cancelled', error = p_reason, next_retry_at = null
      where n.incident_id = p_incident_id and n.template in ('step_fired', 'reminder')
        and n.status = 'queued'
        and n.attempts = (select count(*) from public.notification_attempts a where a.notification_id = n.id)
        and not (p_reason = 'Superseded: acknowledged first' and coalesce((n.context ->> 'fyiStep')::boolean, false))
      returning 1
  )
  select count(*)::integer from c;
$$;

-- ── Fire a step ─────────────────────────────────────────────────────────────
-- S09 body, plus (S10):
--   · an FYI step fires while Acknowledged too, only while the drop is DOWN, and tells everyone it
--     names (the CEO told at L2 hears the FYI too — ChatAlert L3 mentions CEO + AM); the incident's
--     state stays as it is;
--   · a step whose people were all told already reminds them (`reminder`): Tier 2–3 L2 → Tao. It
--     doesn't make the incident Escalated (nobody new was paged, §14.3);
--   · the payload carries who acknowledged (for "acknowledged by Arm 10:07").
create or replace function public.engine_fire_step(
  p_incident_id uuid,
  p_level smallint,
  p_due_at timestamptz,
  p_context jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_step jsonb;
  v_is_fyi boolean;
  v_told uuid[];
  v_new uuid[];
  v_mention uuid[];
  v_fyi uuid[];
  v_others boolean;
  v_reminder boolean := false;
  v_state public.incident_state;
  v_payload jsonb;
  v_acker text;
begin
  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.escalation_level >= p_level or p_level < 1 then
    return false;
  end if;

  select s into v_step
  from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s
  where (s ->> 'level')::smallint = p_level;
  if v_step is null then
    return false;
  end if;
  v_is_fyi := coalesce((v_step ->> 'fyi')::boolean, false);

  if not (v_inc.state in ('unacked', 'escalated')
          or (v_is_fyi and v_inc.state = 'acknowledged')) then
    return false;
  end if;
  -- The FYI says "still DOWN": not on a drop that is only a PROBLEM now (D-023).
  if v_is_fyi and coalesce(v_inc.episode_severity, v_inc.severity) <> 'down' then
    return false;
  end if;
  -- A level due before the incident's first alert went (a run that read it before a late alert after a
  -- mute was stamped, D-036): the ladder counts from that alert, so this one isn't due yet.
  if v_inc.alerted_at is not null and p_due_at < v_inc.alerted_at then
    return false;
  end if;

  -- The thread needs its first alert: none for an incident opened while muted (mute stops new
  -- alerts, §15.1), and none yet while a PROBLEM card waits for response hours (§19.2).
  if not public.engine_thread_live(p_incident_id) then
    return false;
  end if;

  -- Told already: everyone the earlier steps name (L0 = the owner) and every person a fired step told.
  select coalesce(array_agg(distinct u), '{}') into v_told
  from (
    select pe.user_id as u
    from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s,
         public.escalation_people(p_incident_id, s -> 'targets') pe
    where (s ->> 'level')::smallint = 0
    union
    select (jsonb_array_elements_text(e.payload -> 'notified'))::uuid
    from public.incident_events e
    where e.incident_id = p_incident_id and e.type = 'step_fired'
      and e.payload ->> 'severity' = v_inc.severity::text
  ) t;

  if v_is_fyi then
    select coalesce(array_agg(pe.user_id), '{}') into v_new
    from public.escalation_people(p_incident_id, v_step -> 'targets') pe;
    v_mention := v_new;
    v_fyi := '{}';
  else
    select coalesce(array_agg(pe.user_id), '{}'),
           coalesce(bool_or(pe.token <> 'admins'), false)
      into v_new, v_others
    from public.escalation_people(p_incident_id, v_step -> 'targets') pe
    where pe.user_id <> all (v_told);

    if cardinality(v_new) = 0 then
      -- Everyone this step names heard already: remind them (Tier 2–3 L2, "REMINDER · L2" to Tao).
      select coalesce(array_agg(pe.user_id), '{}') into v_new
      from public.escalation_people(p_incident_id, v_step -> 'targets') pe;
      v_reminder := cardinality(v_new) > 0;
      v_mention := v_new;
      v_fyi := '{}';
    else
      select coalesce(array_agg(pe.user_id) filter (where not (v_others and pe.token = 'admins')), '{}'),
             coalesce(array_agg(pe.user_id) filter (where v_others and pe.token = 'admins'), '{}')
        into v_mention, v_fyi
      from public.escalation_people(p_incident_id, v_step -> 'targets') pe
      where pe.user_id = any (v_new);
    end if;
  end if;

  -- Escalated only when someone new was paged while it waits for an ack (spec §14.3).
  v_state := case
    when v_inc.state in ('unacked', 'escalated') and cardinality(v_new) > 0 and not v_reminder
      then 'escalated'::public.incident_state
    else v_inc.state end;
  update public.incidents set state = v_state, escalation_level = p_level where id = p_incident_id;

  if v_inc.acked_by is not null then
    select display_name into v_acker from public.profiles where id = v_inc.acked_by;
  end if;

  v_payload := jsonb_build_object(
    'level', p_level, 'severity', v_inc.severity, 'dueAt', p_due_at,
    'notified', to_jsonb(v_new), 'mentioned', to_jsonb(v_mention), 'fyi', to_jsonb(v_fyi),
    'channels', v_step -> 'channels', 'fyiStep', v_is_fyi, 'reminder', v_reminder)
    || case when v_inc.state = 'acknowledged'
         then jsonb_build_object('ackedBy', v_acker, 'ackedAt', v_inc.acked_at) else '{}'::jsonb end;

  insert into public.incident_events (incident_id, type, payload, at)
  values (p_incident_id, 'step_fired', v_payload, now());

  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('incident.escalated', 'incident', p_incident_id,
          jsonb_build_object('state', v_inc.state, 'escalation_level', v_inc.escalation_level),
          jsonb_build_object('state', v_state, 'escalation_level', p_level));

  if cardinality(v_new) > 0 and v_step -> 'channels' ?| array['chat', 'space'] then
    insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
    values (p_incident_id, 'google_chat', 'step_fired', p_incident_id::text,
            p_context || v_payload, v_inc.severity || ':L' || p_level)
    on conflict do nothing;
  end if;

  -- Voice is configured on the Tier 1 L2 step but never sent until approved (D-009): no row for it.
  if v_step -> 'channels' ? 'email' then
    insert into public.notifications (incident_id, user_id, channel, template, thread_key, context, dedupe_key)
    select p_incident_id, u, 'email', 'step_fired', p_incident_id::text,
           p_context || v_payload || jsonb_build_object('asFyi', u = any (v_fyi)), v_inc.severity || ':L' || p_level
    from unnest(v_new) u
    on conflict do nothing;
  end if;

  return true;
end;
$$;

-- ── The Admin saves the policies: L2–L3 ─────────────────────────────────────
-- S08 body with the S10 guardrails (§14.7, §15.5; the Escalation board's words):
--   · up to L3; the CEO only on Tier 1 DOWN and from L2;
--   · voice only on a Tier 1 DOWN CEO step that isn't the FYI step (stored, never sent);
--   · Tier 1 DOWN keeps exactly one FYI step, last, naming CEO + Site AM; no other policy has one.
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
         or jsonb_typeof(coalesce(v_step -> 'fyi', 'false'::jsonb)) is distinct from 'boolean' then
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
      if not (v_targets <@ array['owner', 'backup', 'admins', 'site_am', 'ceo']
              and v_channels <@ array['chat', 'space', 'email', 'voice']) then
        raise exception 'Unknown person or channel' using errcode = '22023', hint = 'invalid';
      end if;
      -- L0 is the owner by Chat @mention, the Alerts Space and email, at once (PRD §8: locked) —
      -- exactly what engine_open_incident sends, so "already told" at L1 is true.
      if v_level = 0 and not (v_delay = 0 and v_targets = array['owner'] and not v_is_fyi
                              and v_channels @> array['chat', 'space', 'email']
                              and v_channels <@ array['chat', 'space', 'email']) then
        raise exception 'L0 is pinned on every policy' using errcode = '22023', hint = 'l0_pinned';
      end if;
      if v_delay > 10080 then
        raise exception 'At most a week (10080 min)' using errcode = '22023', hint = 'step_too_late';
      end if;
      if cardinality(v_channels) = 0 then
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
    if v_fyi_level is not null and v_fyi_level <> v_count - 1 then
      raise exception 'The CEO + AM FYI step keeps its place' using errcode = '22023', hint = 'fyi_last';
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
