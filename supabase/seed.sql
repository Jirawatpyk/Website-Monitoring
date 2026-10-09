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
    -- instance_id, timestamps and the empty-string tokens let GoTrue load these users (admin API, e2e sign-in).
    insert into auth.users (
      instance_id, id, email, aud, role, raw_app_meta_data, raw_user_meta_data, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, created_at, updated_at
    )
    values (
      '00000000-0000-0000-0000-000000000000', gen_random_uuid(), person.handle || '@example.test',
      'authenticated', 'authenticated', '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', person.display_name), now(), '', '', '', '', now(), now()
    );
  end loop;
end;
$$;

-- Sample Google Chat ids (D-015: owners need one); real ids are set per environment by script.
update public.profiles p set google_chat_user_id = v.chat_id
from (values ('Tao', '100000000000000000001'), ('Arm', '100000000000000000002'),
             ('Ploy', '100000000000000000003'), ('Nok', '100000000000000000004')) as v(name, chat_id)
where p.display_name = v.name;

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

-- Registration fields (D-025): internal client, sample hosting and vault paths.
update public.clients set is_internal = true where name = 'Internal';
update public.sites set hosting = 'Example hosting', credential_ref = 'Team vault › ' || name, monitoring_started_at = now();

-- ── One primary HTTP monitor per site ──
insert into public.monitors (site_id, type, is_primary, url, must_contain)
select id, 'http', true,
       'https://' || trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '.example.test/',
       array[name]
from public.sites;

-- ── S06: state and incident history so Site detail and the Sites list show something locally ──
-- (sample from spec §4 / §5, relative to now: MuvMi 101 DOWN min in 30 days with one drop still open,
-- BA – Taiwan a DOWN and a regional PROBLEM, Fuji Links slow)
update public.sites set monitoring_started_at = now() - interval '120 days';

insert into public.site_status (site_id, status, since, last_round_at, last_evaluated_at)
select id,
  case name when 'MuvMi' then 'down' when 'Fuji Links' then 'problem' else 'ok' end::public.site_state,
  case name when 'MuvMi' then now() - interval '19 minutes' when 'Fuji Links' then now() - interval '15 minutes'
            else now() - interval '10 days 13 hours' end,
  now() - interval '50 seconds', now() - interval '50 seconds'
from public.sites;

with i (site, trigger, severity, state, started, minutes) as (values
  ('MuvMi', 'hard_fail', 'down', 'resolved', interval '17 days', 47),
  ('MuvMi', 'hard_fail', 'down', 'closed', interval '14 days', 35),
  ('MuvMi', 'hard_fail', 'down', 'escalated', interval '19 minutes', null),
  ('Bangkok Airways – Taiwan', 'regional', 'problem', 'resolved', interval '11 days', 6),
  ('Bangkok Airways – Taiwan', 'hard_fail', 'down', 'closed', interval '23 days', 11),
  ('Bangkok Airways – Taiwan', 'slow', 'problem', 'resolved', interval '52 days', 14),
  ('Fuji Links', 'slow', 'problem', 'acknowledged', interval '15 minutes', null)
), ins as (
  insert into public.incidents (site_id, monitor_id, trigger, severity, episode_severity, state, escalation_level,
                                started_at, detected_at, acked_at, recovered_at, resolved_at)
  select s.id, m.id, i.trigger::public.incident_trigger, i.severity::public.severity, i.severity::public.severity,
    i.state::public.incident_state, case i.state when 'escalated' then 1 else 0 end,
    now() - i.started, now() - i.started + interval '30 seconds',
    case when i.state <> 'escalated' then now() - i.started + interval '5 minutes' end,
    case when i.minutes is not null then now() - i.started + make_interval(mins => i.minutes) end,
    case when i.state in ('resolved', 'closed') then now() - i.started + make_interval(mins => i.minutes + 30) end
  from i join public.sites s on s.name = i.site join public.monitors m on m.site_id = s.id and m.is_primary
  returning id, started_at, detected_at, recovered_at
)
insert into public.incident_events (incident_id, type, at, payload)
select id, 'detected', detected_at, '{}'::jsonb from ins
union all
select id, 'recovered', recovered_at, '{}'::jsonb from ins where recovered_at is not null;
