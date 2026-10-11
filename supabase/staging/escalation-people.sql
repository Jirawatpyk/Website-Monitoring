-- DxT Monitor · two test people for the S08 L1 drive (D-035). STAGING ONLY — never run on production.
-- TEMPLATE: replace <tao-chat-user-id> with Tao's Google Chat id — digits only, no `users/` prefix (the
-- number in his Chat resource users/<id>; access/chat-ids.template.sql) — then run it in
-- the staging project's SQL editor. Staging has one real person (Tao) and nobody else can sign up
-- (company domain + allowlist, D-007), so L1 had nobody new to page. These two rows are fixtures, not
-- accounts: no password, no Google identity, so nobody can sign in as them.
--   · "Staging Owner" — the Test target's owner (L0), no Chat id.
--   · "Staging Backup" — its backup (L1). Its Chat id is Tao's, so the L1 @mention reaches Tao in the
--     Space; Tao is the Admin, not yet told, so L1 reads "@Staging Backup … please acknowledge · Tao FYI".
-- Emails go to Resend's test inbox (delivered+…@resend.dev): accepted, never delivered to anyone.
-- Safe to run again. Undo at the bottom.

with people (id, email, name, chat) as (
  values
    ('5ea5e000-0000-4000-8000-000000000001'::uuid, 'delivered+s08-owner@resend.dev', 'Staging Owner', null::text),
    ('5ea5e000-0000-4000-8000-000000000002'::uuid, 'delivered+s08-backup@resend.dev', 'Staging Backup', '<tao-chat-user-id>')
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
  select p.id, p.email, p.name, 'responder', p.chat
  from people p
  where exists (select 1 from new_users u where u.id = p.id)
     or exists (select 1 from auth.users a where a.id = p.id)
  on conflict (id) do update set display_name = excluded.display_name, is_active = true,
    google_chat_user_id = excluded.google_chat_user_id
  returning id
)
update public.sites
set primary_owner_id = '5ea5e000-0000-4000-8000-000000000001',
    backup_owner_id = '5ea5e000-0000-4000-8000-000000000002'
where name = 'Test target' and (select count(*) from new_profiles) = 2;

-- Check: the site's people and who L1 would reach.
select s.name, o.display_name as owner, o.google_chat_user_id is not null as owner_chat,
       b.display_name as backup, b.google_chat_user_id is not null as backup_chat
from public.sites s
left join public.profiles o on o.id = s.primary_owner_id
left join public.profiles b on b.id = s.backup_owner_id
where s.name = 'Test target';

-- ── Undo (after the drive) ─────────────────────────────────────────────────
-- Tao owns the Test target again; the two fixtures are deactivated (their incident and notification
-- rows keep pointing at them, so they aren't deleted).
-- update public.sites set primary_owner_id = (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1),
--   backup_owner_id = null where name = 'Test target';
-- update public.profiles set is_active = false, google_chat_user_id = null
--   where id in ('5ea5e000-0000-4000-8000-000000000001', '5ea5e000-0000-4000-8000-000000000002');
