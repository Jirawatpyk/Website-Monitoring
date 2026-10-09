-- S07 (D-033): add_incident_note as in 20261009120515, with a limit — at most 5 notes a minute per
-- person and incident. Each note posts to Chat at once (no hold), so a burst could use up the alerts
-- space's webhook quota that DOWN alerts share (S07 security review L1).
create or replace function public.add_incident_note(p_incident_id uuid, p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inc public.incidents%rowtype;
  v_text text := btrim(coalesce(p_text, ''));
  v_name text;
  v_event uuid;
begin
  -- The row lock queues a person's rapid notes on one incident, so the count below sees each one.
  select * into v_inc from public.incidents where id = p_incident_id for no key update;
  if not found then
    raise exception 'incident not found' using errcode = 'P0002';
  end if;
  if not private.can_ack(v_inc.site_id) then
    raise exception 'This role can''t add notes to this incident' using errcode = '42501';
  end if;
  if v_text = '' then
    raise exception 'Write the note first' using errcode = '22023';
  end if;
  if length(v_text) > 2000 then
    raise exception 'Keep the note under 2,000 characters' using errcode = '22023';
  end if;
  -- At most 5 notes a minute per person and incident: each is a Chat post at once, and a burst
  -- would crowd the space's webhook quota that DOWN alerts share (S07 security review L1).
  if (select count(*) from public.incident_events
      where incident_id = p_incident_id and type = 'note' and actor_id = auth.uid()
        and at > now() - interval '1 minute') >= 5 then
    raise exception 'That''s 5 notes in a minute — wait a moment before the next one' using errcode = '55000';
  end if;

  select display_name into v_name from public.profiles where id = auth.uid();

  insert into public.incident_events (incident_id, type, actor_id, payload)
  values (p_incident_id, 'note', auth.uid(), jsonb_build_object('text', v_text, 'by', v_name))
  returning id into v_event;

  insert into public.audit_log (actor_id, action, entity, entity_id, after)
  values (auth.uid(), 'incident.note', 'incident', p_incident_id,
          jsonb_build_object('event', v_event, 'text', v_text));

  -- Into the thread only where there is one (a muted incident has none).
  insert into public.notifications (incident_id, channel, template, thread_key, context, dedupe_key)
  select p_incident_id, 'google_chat', 'note', p_incident_id::text,
         jsonb_build_object('text', v_text, 'by', v_name, 'byId', auth.uid()), v_event::text
  where exists (
    select 1 from public.notifications
    where incident_id = p_incident_id and channel = 'google_chat'
      and template in ('down', 'problem') and status <> 'cancelled'
  )
  on conflict do nothing;

  return v_event;
end;
$$;
