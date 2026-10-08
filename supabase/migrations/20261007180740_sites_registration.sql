-- DxT Monitor · S05 sites and monitors (FR-01, D-015, D-025).
-- Registration fields on sites / clients / monitors; one audit_log row for every inserted, updated or
-- deleted site, monitor or client (trigger — the change and its audit row share a transaction); the
-- owner and "ready to monitor" rules for signed-in writes; and the write RPCs the Sites screens call.
-- Migration before code: the new columns have defaults and nothing reads them yet.

-- ── Columns ───────────────────────────────────────────────────────────────
-- Where the team finds access (a vault path) — never the credential itself (PRD §4).
alter table public.sites
  add column credential_ref text check (credential_ref is null or btrim(credential_ref) <> ''),
  add column behind_waf boolean not null default false,
  add column waf_allowlist_confirmed boolean not null default false,
  -- First Start monitoring; a Draft that was never started has none (and can be deleted).
  add column monitoring_started_at timestamptz;

-- An internal (DxT group) client needs no account manager and gets no client updates (S11).
alter table public.clients add column is_internal boolean not null default false;

alter table public.monitors
  -- Custom request headers [{name, value}] sent from every location and the browser verifier. Names
  -- are checked in the app (D-025: no Host / Cookie / Authorization / User-Agent / probe header).
  add column headers jsonb not null default '[]'
    check (jsonb_typeof(headers) = 'array' and jsonb_array_length(headers) <= 10),
  add column enabled boolean not null default true,
  -- A monitor with history is removed, not deleted: its results stay for their 90 days.
  add column removed_at timestamptz,
  add constraint monitors_primary_always_on check (not is_primary or (enabled and removed_at is null)),
  -- A probe gives up after 30 s (PRD §5); the boards default to it.
  alter column timeout_ms set default 30000;

-- One site per primary URL: "Already monitored as another site" (AddSite). The app stores URLs
-- normalised (lower-case host, no fragment), so case and a trailing slash are the only variants left.
create unique index monitors_primary_url_key on public.monitors (lower(rtrim(url, '/'))) where is_primary;

-- ── Audit: one row per changed row ────────────────────────────────────────
-- Actor = the signed-in person (null for the service role and SQL scripts). An update that changes
-- nothing but updated_at writes no row. security definer: people can't insert into audit_log.
create function private.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_before jsonb;
  v_after jsonb;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_action := v_entity || '.create';
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    if (v_before - 'updated_at') = (v_after - 'updated_at') then
      return null;
    end if;
    v_action := v_entity || '.update';
  else
    v_before := to_jsonb(old);
    v_action := v_entity || '.delete';
  end if;

  insert into public.audit_log (actor_id, action, entity, entity_id, before, after)
  values (
    (select p.id from public.profiles p where p.id = auth.uid()),
    v_action, v_entity, coalesce(v_after ->> 'id', v_before ->> 'id')::uuid, v_before, v_after
  );
  return null;
end;
$$;

create trigger sites_audit after insert or update or delete on public.sites
  for each row execute function private.audit_row_change('site');
create trigger monitors_audit after insert or update or delete on public.monitors
  for each row execute function private.audit_row_change('monitor');
create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function private.audit_row_change('client');

-- ── Owners (D-015) ────────────────────────────────────────────────────────
-- A signed-in write that sets an owner or backup must name an active Admin / Responder with a Google
-- Chat id (they are @mentioned and may acknowledge). Either may stay empty on a Draft (D-025).
-- SQL scripts and the service role are not limited (seed, staging test target): the check keys on the
-- session's `role` setting (PostgREST sets `authenticated`), not on JWT claims a script may carry.
create function private.sites_guard_owners()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ineligible text;
  v_unlinked text;
begin
  if current_setting('role', true) is distinct from 'authenticated' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.primary_owner_id is not distinct from old.primary_owner_id
     and new.backup_owner_id is not distinct from old.backup_owner_id then
    return new;
  end if;

  select string_agg(coalesce(p.display_name, p.email), ', ' order by o.ord)
           filter (where not p.is_active or p.role not in ('admin', 'responder')),
         string_agg(coalesce(p.display_name, p.email), ', ' order by o.ord)
           filter (where p.is_active and p.role in ('admin', 'responder')
                     and nullif(btrim(p.google_chat_user_id), '') is null)
    into v_ineligible, v_unlinked
  from (values (new.primary_owner_id, 1), (new.backup_owner_id, 2)) as o (id, ord)
  join public.profiles p on p.id = o.id;

  if v_ineligible is not null then
    raise exception 'Only an active Admin or Responder can own a site: %', v_ineligible
      using errcode = 'P0001', hint = 'owners_not_eligible', detail = v_ineligible;
  end if;
  if v_unlinked is not null then
    raise exception 'Owners need a Google Chat id: %', v_unlinked
      using errcode = 'P0001', hint = 'owners_missing_chat_id', detail = v_unlinked;
  end if;
  return new;
end;
$$;

-- Named to run after D-012's sites_guard_update (triggers fire in name order).
create trigger sites_require_linked_owners before insert or update on public.sites
  for each row execute function private.sites_guard_owners();

-- ── Ready to monitor (registration checklist, PRD §4) ─────────────────────
-- The checklist's required items still missing for a site, by their short names (the AddSite
-- "items left" line; `registrationChecklist` in @dxt/shared mirrors it for the form).
create function private.site_start_problems(p_site_id uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when pm.id is null then 'URL' end,
    case when pm.id is not null and cardinality(pm.must_contain) = 0 then 'Brand keyword' end,
    case when po.id is null or not po.is_active or nullif(btrim(po.google_chat_user_id), '') is null
         then 'Primary owner' end,
    case when bo.id is null or not bo.is_active or nullif(btrim(bo.google_chat_user_id), '') is null
         then 'Backup owner' end,
    case when not c.is_internal and c.am_user_id is null then 'Account manager' end,
    case when nullif(btrim(s.hosting), '') is null then 'Hosting provider' end,
    case when s.credential_ref is null then 'Credential reference' end
  ], null)
  from public.sites s
  join public.clients c on c.id = s.client_id
  left join public.monitors pm on pm.site_id = s.id and pm.is_primary
  left join public.profiles po on po.id = s.primary_owner_id
  left join public.profiles bo on bo.id = s.backup_owner_id
  where s.id = p_site_id;
$$;

-- A live site (monitoring started) must stay complete. Checked at commit, so a site and its
-- monitors can be written in one transaction. Signed-in writes only; a mute alone isn't re-checked.
create function private.site_assert_ready(p_site_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problems text[];
begin
  if not exists (select 1 from public.sites where id = p_site_id and is_active) then
    return;
  end if;
  v_problems := private.site_start_problems(p_site_id);
  if cardinality(v_problems) > 0 then
    raise exception 'Not ready to monitor: %', array_to_string(v_problems, ', ')
      using errcode = 'P0001', hint = 'site_not_ready', detail = array_to_string(v_problems, ', ');
  end if;
end;
$$;

create function private.sites_check_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'authenticated' or not new.is_active then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.is_active
     and (to_jsonb(new) - 'muted_until' - 'mute_reason' - 'updated_at')
         = (to_jsonb(old) - 'muted_until' - 'mute_reason' - 'updated_at') then
    return null;
  end if;
  perform private.site_assert_ready(new.id);
  return null;
end;
$$;

create constraint trigger sites_check_ready after insert or update on public.sites
  deferrable initially deferred
  for each row execute function private.sites_check_ready();

create function private.monitors_check_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) is distinct from 'authenticated' then
    return null;
  end if;
  perform private.site_assert_ready(case when tg_op = 'DELETE' then old.site_id else new.site_id end);
  return null;
end;
$$;

create constraint trigger monitors_check_ready after insert or update or delete on public.monitors
  deferrable initially deferred
  for each row execute function private.monitors_check_ready();

-- ── Write RPCs (signed-in Admins; security invoker, so RLS and the triggers above still decide) ──
-- p_site: {client_id, name, tier, primary_owner_id?, backup_owner_id?, hosting?, credential_ref?,
--          notes?, behind_waf?, waf_allowlist_confirmed?}
-- p_monitors (save_monitors' p_upserts): [{id?, is_primary, url, method?, timeout_ms?, must_contain?,
--          must_not_contain?, allowed_redirect_domains?, thresholds?, headers?, enabled?}]

create function public.save_monitors(p_site_id uuid, p_upserts jsonb, p_removals uuid[] default '{}')
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_m jsonb;
  v_id uuid;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Only an Admin can change monitors' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id) then
    raise exception 'Site not found' using errcode = 'P0002';
  end if;

  -- Removals first, so a removed key page frees its place for a new one.
  foreach v_id in array coalesce(p_removals, '{}') loop
    if exists (select 1 from public.monitors where id = v_id and site_id = p_site_id and is_primary) then
      raise exception 'The primary monitor can''t be removed'
        using errcode = 'P0001', hint = 'primary_not_removable';
    end if;
    begin
      delete from public.monitors where id = v_id and site_id = p_site_id;
    exception when foreign_key_violation then
      -- It has check results or incidents: keep the row for the record, stop checking it.
      update public.monitors set removed_at = now(), enabled = false
        where id = v_id and site_id = p_site_id and removed_at is null;
    end;
  end loop;

  for v_m in select * from jsonb_array_elements(coalesce(p_upserts, '[]')) loop
    if nullif(v_m ->> 'id', '') is null then
      insert into public.monitors (
        site_id, type, is_primary, url, method, timeout_ms, must_contain, must_not_contain,
        allowed_redirect_domains, thresholds, headers, enabled
      ) values (
        p_site_id, 'http', coalesce((v_m ->> 'is_primary')::boolean, false), v_m ->> 'url',
        coalesce(v_m ->> 'method', 'GET'), coalesce((v_m ->> 'timeout_ms')::integer, 30000),
        array(select jsonb_array_elements_text(coalesce(v_m -> 'must_contain', '[]'))),
        array(select jsonb_array_elements_text(coalesce(v_m -> 'must_not_contain', '[]'))),
        array(select jsonb_array_elements_text(coalesce(v_m -> 'allowed_redirect_domains', '[]'))),
        coalesce(v_m -> 'thresholds', '{}'), coalesce(v_m -> 'headers', '[]'),
        coalesce((v_m ->> 'enabled')::boolean, true)
      );
    else
      update public.monitors set
        url = v_m ->> 'url',
        method = coalesce(v_m ->> 'method', method),
        timeout_ms = coalesce((v_m ->> 'timeout_ms')::integer, timeout_ms),
        must_contain = array(select jsonb_array_elements_text(coalesce(v_m -> 'must_contain', '[]'))),
        must_not_contain = array(select jsonb_array_elements_text(coalesce(v_m -> 'must_not_contain', '[]'))),
        allowed_redirect_domains =
          array(select jsonb_array_elements_text(coalesce(v_m -> 'allowed_redirect_domains', '[]'))),
        thresholds = coalesce(v_m -> 'thresholds', thresholds),
        headers = coalesce(v_m -> 'headers', headers),
        enabled = coalesce((v_m ->> 'enabled')::boolean, enabled)
      where id = (v_m ->> 'id')::uuid and site_id = p_site_id and removed_at is null;
      if not found then
        raise exception 'Monitor not found' using errcode = 'P0002';
      end if;
    end if;
  end loop;

  if not exists (select 1 from public.monitors where site_id = p_site_id and is_primary) then
    raise exception 'A site needs its primary monitor' using errcode = 'P0001', hint = 'primary_required';
  end if;
  if (select count(*) from public.monitors
      where site_id = p_site_id and not is_primary and removed_at is null) > 3 then
    raise exception 'At most 3 key pages per site' using errcode = 'P0001', hint = 'too_many_key_pages';
  end if;
end;
$$;

create function public.create_site(p_site jsonb, p_monitors jsonb, p_start boolean default false)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Only an Admin can add a site' using errcode = '42501';
  end if;

  insert into public.sites (
    client_id, name, tier, primary_owner_id, backup_owner_id, hosting, credential_ref, notes,
    behind_waf, waf_allowlist_confirmed, is_active, monitoring_started_at
  ) values (
    (p_site ->> 'client_id')::uuid, btrim(p_site ->> 'name'), (p_site ->> 'tier')::smallint,
    nullif(p_site ->> 'primary_owner_id', '')::uuid, nullif(p_site ->> 'backup_owner_id', '')::uuid,
    nullif(btrim(p_site ->> 'hosting'), ''), nullif(btrim(p_site ->> 'credential_ref'), ''),
    nullif(btrim(p_site ->> 'notes'), ''),
    coalesce((p_site ->> 'behind_waf')::boolean, false),
    coalesce((p_site ->> 'waf_allowlist_confirmed')::boolean, false),
    coalesce(p_start, false), case when p_start then now() end
  ) returning id into v_id;

  perform public.save_monitors(v_id, p_monitors, '{}');
  return v_id;
end;
$$;

-- Edit site: the same fields as create_site (monitoring on / off goes through set_site_monitoring).
create function public.update_site(p_site_id uuid, p_site jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Only an Admin can change this site''s settings' using errcode = '42501';
  end if;

  update public.sites set
    client_id = (p_site ->> 'client_id')::uuid,
    name = btrim(p_site ->> 'name'),
    tier = (p_site ->> 'tier')::smallint,
    primary_owner_id = nullif(p_site ->> 'primary_owner_id', '')::uuid,
    backup_owner_id = nullif(p_site ->> 'backup_owner_id', '')::uuid,
    hosting = nullif(btrim(p_site ->> 'hosting'), ''),
    credential_ref = nullif(btrim(p_site ->> 'credential_ref'), ''),
    -- Notes have no field in the form yet: keep them unless the caller sends the key.
    notes = case when p_site ? 'notes' then nullif(btrim(p_site ->> 'notes'), '') else notes end,
    behind_waf = coalesce((p_site ->> 'behind_waf')::boolean, false),
    waf_allowlist_confirmed = coalesce((p_site ->> 'waf_allowlist_confirmed')::boolean, false)
  where id = p_site_id;
  if not found then
    raise exception 'Site not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Start monitoring (checked against the registration checklist at commit) or stop it (back to a
-- Draft: checks stop at once, an open incident stays open — D-025).
create function public.set_site_monitoring(p_site_id uuid, p_on boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Only an Admin can start or stop monitoring' using errcode = '42501';
  end if;

  update public.sites set
    is_active = p_on,
    monitoring_started_at = case when p_on then coalesce(monitoring_started_at, now()) else monitoring_started_at end
  where id = p_site_id;
  if not found then
    raise exception 'Site not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Delete a Draft that has no history (check results, incidents); anything else is stopped instead.
create function public.delete_site(p_site_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if public.current_app_role() is distinct from 'admin' then
    raise exception 'Only an Admin can delete a site' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sites where id = p_site_id) then
    raise exception 'Site not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.sites where id = p_site_id and is_active) then
    raise exception 'Stop monitoring before deleting' using errcode = 'P0001', hint = 'site_is_live';
  end if;

  begin
    delete from public.monitors where site_id = p_site_id;
    delete from public.sites where id = p_site_id;
  exception when foreign_key_violation then
    raise exception 'The site has monitoring history and stays for the record'
      using errcode = 'P0001', hint = 'site_has_history';
  end;
end;
$$;

revoke execute on function public.save_monitors(uuid, jsonb, uuid[]) from public, anon;
revoke execute on function public.create_site(jsonb, jsonb, boolean) from public, anon;
revoke execute on function public.update_site(uuid, jsonb) from public, anon;
revoke execute on function public.set_site_monitoring(uuid, boolean) from public, anon;
revoke execute on function public.delete_site(uuid) from public, anon;
grant execute on function public.save_monitors(uuid, jsonb, uuid[]) to authenticated;
grant execute on function public.create_site(jsonb, jsonb, boolean) to authenticated;
grant execute on function public.update_site(uuid, jsonb) to authenticated;
grant execute on function public.set_site_monitoring(uuid, boolean) to authenticated;
grant execute on function public.delete_site(uuid) to authenticated;
