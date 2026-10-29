-- DxT Monitor · fixture people for the S10 T05 drive (L0 → L1 → L2 → L3; D-048). STAGING ONLY — never
-- run on production. TEMPLATE: replace <tao-chat-user-id> with Tao's Google Chat id (digits only) and run
-- it in the staging project's SQL editor. Claude runs it on staging for S10 (D-048 item 7).
-- Fixtures, not accounts (no password, no Google identity — nobody signs in as them), as D-035:
--   · "Staging Owner"  — the Test target's owner (L0), no Chat id.
--   · "Staging Backup" — its backup (L1), Tao's Chat id.
--   · "Staging CEO"    — a stakeholder who manages no client: the `ceo` token (L2, L3), Tao's Chat id.
--   · "Staging AM"     — the Test target client's AM: the `site_am` token (L3 FYI), Tao's Chat id.
-- Every @mention lands on Tao in the staging Space. Emails go to Resend's test inbox
-- (delivered+…@resend.dev): accepted, never delivered. Safe to run again. Undo at the bottom.

with people (id, email, name, role, chat) as (
  values
    ('5ea5e000-0000-4000-8000-000000000001'::uuid, 'delivered+s08-owner@resend.dev', 'Staging Owner', 'responder'::public.app_role, null::text),
    ('5ea5e000-0000-4000-8000-000000000002'::uuid, 'delivered+s08-backup@resend.dev', 'Staging Backup', 'responder', '<tao-chat-user-id>'),
    ('5ea5e000-0000-4000-8000-000000000003'::uuid, 'delivered+s10-ceo@resend.dev', 'Staging CEO', 'stakeholder', '<tao-chat-user-id>'),
    ('5ea5e000-0000-4000-8000-000000000004'::uuid, 'delivered+s10-am@resend.dev', 'Staging AM', 'stakeholder', '<tao-chat-user-id>')
), new_users as (
  -- No provider in raw_app_meta_data, so `handle_new_user` makes no profile; the insert below does.
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
         '{}'::jsonb, jsonb_build_object('full_name', name), now(), now()
  from people
  on conflict (id) do nothing
  returning id
), new_profiles as (
  insert into public.profiles (id, email, display_name, role, google_chat_user_id)
  select p.id, p.email, p.name, p.role, p.chat
  from people p
  where exists (select 1 from new_users u where u.id = p.id)
     or exists (select 1 from auth.users a where a.id = p.id)
  on conflict (id) do update set display_name = excluded.display_name, role = excluded.role, is_active = true,
    google_chat_user_id = excluded.google_chat_user_id
  returning id
), owners as (
  update public.sites
  set primary_owner_id = '5ea5e000-0000-4000-8000-000000000001',
      backup_owner_id = '5ea5e000-0000-4000-8000-000000000002'
  where name = 'Test target' and (select count(*) from new_profiles) = 4
  returning client_id
)
update public.clients set am_user_id = '5ea5e000-0000-4000-8000-000000000004'
where id in (select client_id from owners);

-- Check: the site's people, its AM and who the CEO token names.
select s.name, o.display_name as owner, b.display_name as backup, a.display_name as am,
       b.google_chat_user_id is not null as backup_chat,
       (select string_agg(display_name, ', ') from public.escalation_people(
          (select id from public.incidents where site_id = s.id order by created_at desc limit 1), '["ceo"]')
        join public.profiles p on p.id = user_id) as ceo
from public.sites s
left join public.profiles o on o.id = s.primary_owner_id
left join public.profiles b on b.id = s.backup_owner_id
left join public.clients c on c.id = s.client_id
left join public.profiles a on a.id = c.am_user_id
where s.name = 'Test target';

-- ── Undo (after the drive) ─────────────────────────────────────────────────
-- Tao owns the Test target again, the client has no AM, and the four fixtures are deactivated (their
-- incident and notification rows keep pointing at them, so they aren't deleted).
-- update public.clients set am_user_id = null where am_user_id = '5ea5e000-0000-4000-8000-000000000004';
-- update public.sites set primary_owner_id = (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1),
--   backup_owner_id = null where name = 'Test target';
-- update public.profiles set is_active = false, google_chat_user_id = null
--   where id in ('5ea5e000-0000-4000-8000-000000000001', '5ea5e000-0000-4000-8000-000000000002',
--                '5ea5e000-0000-4000-8000-000000000003', '5ea5e000-0000-4000-8000-000000000004');
