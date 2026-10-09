-- DxT Monitor · undo generate-checks.sql (S06, D-031). LOCAL OR STAGING ONLY.
-- Deletes the generated raw checks (resolved_ip 192.0.2.1) and the rollups older than the generated
-- range's end, then rebuilds the rollups from the real checks left. Real checks are never touched.
--   set dxt.generate = 'staging';   -- or 'local'

do $$
declare
  v_mode text := current_setting('dxt.generate', true);
  v_end timestamptz;
begin
  if v_mode is null or v_mode not in ('local', 'staging') then
    raise exception 'Refusing: set dxt.generate to local or staging first';
  end if;
  -- Refuse any database that watches a real site: every live site's primary monitor must point at
  -- the local seed (*.example.test) or the staging test target. Production fails this whatever the
  -- session says, so a script pasted into the wrong SQL editor stops here (security review H1).
  if not exists (select 1 from public.sites where is_active) or exists (
    select 1 from public.monitors m join public.sites s on s.id = m.site_id and s.is_active
    where m.is_primary
      and m.url !~* '^https?://([a-z0-9-]+\.)*example\.test(:[0-9]+)?(/|\?|$)'
      and m.url !~* '^https?://dxt-test-target\.vercel\.app(/|\?|$)'
  ) then
    raise exception 'Refusing: this database watches real sites (or none) — local seed or staging only';
  end if;

  select max(checked_at) into v_end from public.check_results where resolved_ip = '192.0.2.1';
  if v_end is null then
    raise notice 'No generated checks found';
    return;
  end if;
  delete from public.check_results where resolved_ip = '192.0.2.1';
  delete from public.check_rollups where bucket_start <= v_end;
  perform private.rollup_check_results('hour', now() - interval '90 days', now());
  perform private.rollup_check_results('day', now() - interval '90 days', now());
end;
$$;
