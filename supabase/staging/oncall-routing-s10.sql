-- DxT Monitor · the S10 on-call drive (Done-when 3: outside response hours a Tier 1 DOWN pages the
-- person on call, not the owner; D-048). STAGING ONLY — never run on production. Run it in the staging
-- project's SQL editor after `escalation-people-s10.sql` (Claude runs it on staging, D-048 item 7).
--   · "Staging OnCall" — a Responder fixture with the Chat id of "Staging Backup" (Tao's), so the
--     @mention lands on Tao; no password, nobody signs in as them (D-035).
--   · A one-person rotation and its weeks from now: the person on call is Staging OnCall.
-- Then, outside response hours (or with `response_end` set to a minute ago — restore it after),
-- set the test target to `error` and read who the DOWN card @mentioned (the check below).
-- Safe to run again. Undo at the bottom.

with fixture as (
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('5ea5e000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'delivered+s10-oncall@resend.dev', '{}'::jsonb,
          jsonb_build_object('full_name', 'Staging OnCall'), now(), now())
  on conflict (id) do nothing
  returning id
)
insert into public.profiles (id, email, display_name, role, google_chat_user_id)
select '5ea5e000-0000-4000-8000-000000000005', 'delivered+s10-oncall@resend.dev', 'Staging OnCall', 'responder',
       (select google_chat_user_id from public.profiles where id = '5ea5e000-0000-4000-8000-000000000002')
where exists (select 1 from auth.users where id = '5ea5e000-0000-4000-8000-000000000005')
   or exists (select 1 from fixture)
on conflict (id) do update set is_active = true, role = 'responder',
  google_chat_user_id = excluded.google_chat_user_id;

-- The rotation is Staging OnCall alone; the weeks are made again from this week.
delete from public.oncall_swaps;
delete from public.oncall_shifts;
delete from public.oncall_rotation;
insert into public.oncall_rotation (user_id, position) values ('5ea5e000-0000-4000-8000-000000000005', 1);
select public.oncall_extend_shifts(now() + interval '28 days') as weeks_made;

-- Check: who is on call now, and the latest Test target incident's L0 person and DOWN card mention.
select public.oncall_person_at(now()) = '5ea5e000-0000-4000-8000-000000000005' as oncall_is_fixture,
       (select l0_user_id from public.incidents i join public.sites s on s.id = i.site_id
        where s.name = 'Test target' order by i.created_at desc limit 1) as latest_l0;

-- ── Undo (after the drive) ─────────────────────────────────────────────────
-- delete from public.oncall_shifts; delete from public.oncall_rotation;
-- update public.profiles set is_active = false where id = '5ea5e000-0000-4000-8000-000000000005';
