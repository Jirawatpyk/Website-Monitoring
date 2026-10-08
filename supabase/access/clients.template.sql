-- DxT Monitor · clients and account managers (S05, D-025). TEMPLATE — placeholders only; never commit
-- real client names, contacts or addresses.
--
-- Add site picks the client from this list and shows its account manager read-only; a client site can't
-- start monitoring until its client has an AM. Until the clients screen (S17) an Admin keeps the list here,
-- per environment, in that Supabase project's SQL editor. Every insert / update is audited (actor empty,
-- because it runs as a script). The AM must have signed in once. `is_internal` = a DxT group site: no AM,
-- no client updates.

insert into public.clients (name, is_internal, am_user_id, contact_email, language)
values
  ('<Internal (DxT group)>', true, null, null, 'en'),
  ('<Client name>', false, (select id from public.profiles where email = lower('<am.first.last>@<company-domain>')),
   lower('<contact@client-domain>'), 'en')
on conflict (name) do update
  set is_internal = excluded.is_internal,
      am_user_id = excluded.am_user_id,
      contact_email = excluded.contact_email,
      language = excluded.language;

-- Check
-- select c.name, c.is_internal, p.display_name as am from public.clients c
-- left join public.profiles p on p.id = c.am_user_id order by c.is_internal desc, c.name;
