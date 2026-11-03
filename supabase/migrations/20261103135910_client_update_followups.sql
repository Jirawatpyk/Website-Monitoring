-- S11 follow-ups to engine_client_update_due (engine review L5, L6; message check; D-052 item 7).
--   · The thread check looks for a live DOWN / DOWN AGAIN Chat row itself. engine_thread_live looks for
--     the current drop's severity, so after a recovery into a PROBLEM AGAIN held outside response hours
--     (episode_severity 'problem') a due Tier 2 track waited until 09:00.
--   · A floor on p_due_at: never before started_at + 15 min (Tier 1's 15 min; Tier 2's 60 min and a
--     mute's alerted_at are later still). The runner's due time is no longer trusted blindly.
--   · Fired in the minute the site recovered: the RECOVERED emails were queued before the AM had an
--     email row, so the AM (or the Admins with no AM) gets that round's RECOVERED email here.

set local lock_timeout = '5s';

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
    from public.escalation_people(p_incident_id, '["admins"]'::jsonb) pe;
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

revoke execute on function public.engine_client_update_due(uuid, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.engine_client_update_due(uuid, timestamptz, jsonb) to service_role;
