-- S10 · Escalation L2–L3, review fixes (/code-review on S10 PR A; D-048).
--   · engine_remind: the STILL DOWN reminders @mention the people asked to act, never the CEO or the
--     site's AM — L2 / L3 tell them once (spec §8, §18: the CEO needs no action on an FYI).
--   · save_escalation_policies: a step whose only channel is voice notifies nobody (voice is off until
--     approved, D-009) and is refused like a step with none; a JSON null `fyi` reads as not the FYI step.

create or replace function public.engine_remind(
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
  v_mention uuid[];
  v_id uuid;
  v_key text;
begin
  -- Most calls find the reminder already queued (every engine run asks): answer from the index
  -- before taking the incident's lock (db review).
  select i.severity || ':' || to_char(p_due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') into v_key
  from public.incidents i where i.id = p_incident_id;
  if v_key is null or exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat' and template = 'reminder'
      and dedupe_key = v_key and status <> 'cancelled'
  ) then
    return false;
  end if;

  select * into v_inc from public.incidents where id = p_incident_id for update;
  if not found or v_inc.state not in ('unacked', 'escalated') or v_inc.escalation_plan is null
     or not public.engine_thread_live(p_incident_id)
     or (v_inc.alerted_at is not null and p_due_at < v_inc.alerted_at) then
    return false;
  end if;

  -- The people asked to act: L0's (not the Admins) and everyone a fired step @mentioned — except the
  -- CEO and the site's AM, who are told once at L2 / L3 and never asked to acknowledge (spec §8, §18).
  select coalesce(array_agg(distinct u), '{}') into v_mention
  from (
    select pe.user_id as u
    from jsonb_array_elements(v_inc.escalation_plan -> 'steps') s,
         public.escalation_people(p_incident_id, s -> 'targets') pe
    where (s ->> 'level')::smallint = 0 and pe.token <> 'admins'
    union
    select (jsonb_array_elements_text(e.payload -> 'mentioned'))::uuid
    from public.incident_events e
    where e.incident_id = p_incident_id and e.type = 'step_fired'
      and e.payload ->> 'severity' = v_inc.severity::text
  ) t
  where u not in (select pe.user_id from public.escalation_people(p_incident_id, '["ceo", "site_am"]') pe);

  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  values (p_incident_id, 'google_chat', 'reminder', p_incident_id::text,
          p_context || jsonb_build_object('dueAt', p_due_at, 'severity', v_inc.severity,
                                          'mentioned', to_jsonb(v_mention)),
          v_inc.severity || ':' || to_char(p_due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"'))
  on conflict do nothing
  returning id into v_id;

  return v_id is not null;
end;
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
