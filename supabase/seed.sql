-- Local development seed only (runs on `pnpm db:reset`). Never run against staging or production.
-- Sample data from the design spec (§2 people, §3 sites, Organisation board clients) so screens can
-- be compared with the canvas boards. Addresses use the reserved `example.test` domain and URLs point
-- at `*.example.test`, so nothing here can sign in with Google or probe a real site.
-- To sign in locally with your own Google account, also run supabase/access/allowlist.template.sql
-- with your domain and address.

insert into private.allowed_email_domains (domain) values ('example.test') on conflict do nothing;

-- ── People: allowlist rows, then auth users (the sign-up trigger creates each profile) ──
do $$
declare
  person record;
begin
  for person in
    select * from (values
      ('tao',  'Tao',  'admin'::public.app_role),
      ('arm',  'Arm',  'responder'),
      ('ploy', 'Ploy', 'responder'),
      ('nok',  'Nok',  'responder'),
      ('thee', 'Thee', 'stakeholder'),
      ('bua',  'Bua',  'stakeholder'),
      ('ceo',  'CEO',  'stakeholder'),
      ('mint', 'Mint', 'viewer')
    ) as p(handle, display_name, role)
  loop
    insert into private.allowed_emails (email, role)
    values (person.handle || '@example.test', person.role);
    insert into auth.users (id, email, aud, role, raw_user_meta_data, email_confirmed_at)
    values (gen_random_uuid(), person.handle || '@example.test', 'authenticated', 'authenticated',
            jsonb_build_object('full_name', person.display_name), now());
  end loop;
end;
$$;

-- ── Clients ──
insert into public.clients (name, am_user_id, language)
select c.name, (select id from public.profiles where display_name = c.am), c.language
from (values
  ('Bangkok Airways', 'Bua',  'en'),
  ('ENEOS',           'Thee', 'en'),
  ('MuvMi',           'Bua',  'th'),
  ('realme',          'Thee', 'en'),
  ('Fuji Links',      'Thee', 'th'),
  ('Tubtong',         'Bua',  'th'),
  ('Cando Asia',      'Bua',  'en'),
  ('ORCA Thailand',   'Thee', 'th'),
  ('WeCare',          'Bua',  'th'),
  ('Internal',        null,   'en')
) as c(name, am, language);

-- ── Sites (tier · owner · backup · client) ──
insert into public.sites (client_id, name, tier, primary_owner_id, backup_owner_id)
select
  (select id from public.clients where name = s.client),
  s.name,
  s.tier,
  (select id from public.profiles where display_name = s.owner),
  (select id from public.profiles where display_name = s.backup)
from (values
  ('Bangkok Airways – Taiwan', 1, 'Arm',  'Ploy', 'Bangkok Airways'),
  ('Bangkok Airways – China',  1, 'Arm',  'Ploy', 'Bangkok Airways'),
  ('ENEOS Industrial',         1, 'Ploy', 'Arm',  'ENEOS'),
  ('MuvMi',                    1, 'Arm',  'Ploy', 'MuvMi'),
  ('realme.link',              1, 'Nok',  'Arm',  'realme'),
  ('Fuji Links',               2, 'Ploy', 'Nok',  'Fuji Links'),
  ('WeCare Studio',            2, 'Nok',  'Ploy', 'WeCare'),
  ('Tubtong',                  2, 'Ploy', 'Nok',  'Tubtong'),
  ('Cando Asia',               2, 'Nok',  'Ploy', 'Cando Asia'),
  ('ORCA Thailand',            2, 'Tao',  'Nok',  'ORCA Thailand'),
  ('WeCare Asia',              2, 'Nok',  'Ploy', 'WeCare'),
  ('VOCA',                     2, 'Ploy', 'Tao',  'Internal'),
  ('EQHO',                     2, 'Tao',  'Nok',  'Internal'),
  ('DxT',                      2, 'Tao',  'Nok',  'Internal'),
  ('DxT Solutions',            3, 'Tao',  'Nok',  'Internal'),
  ('DxT AI',                   3, 'Tao',  'Nok',  'Internal'),
  ('DxT Games',                3, 'Tao',  'Nok',  'Internal')
) as s(name, tier, owner, backup, client);

-- ── One primary HTTP monitor per site ──
insert into public.monitors (site_id, type, is_primary, url)
select id, 'http', true,
       'https://' || trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '.example.test/'
from public.sites;
