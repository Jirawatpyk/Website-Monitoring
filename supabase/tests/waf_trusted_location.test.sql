-- S05b (D-027): check_results.waf and control_ok — a WAF signature only on a blocked check.
begin;
\ir _helpers.psql
select plan(12);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
insert into ids values ('arm', tests.create_user('arm@pgtap.test', 'responder'));
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, behind_waf) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Site A', 1,
   (select id from ids where name = 'arm'), true);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'http', true,
   'https://a.pgtap.test');

select has_column('public', 'check_results', 'waf', 'check_results.waf exists');
select has_column('public', 'check_results', 'control_ok', 'check_results.control_ok exists');

select lives_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, waf)
    values ('00000000-0000-0000-0000-0000000000d1', 'SIN', now(), 'blocked', 403, 'akamai')$$,
  'a blocked check stores its WAF signature'
);
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, waf)
    values ('00000000-0000-0000-0000-0000000000d1', 'SIN', now(), 'pass', 200, 'akamai')$$,
  '23514', null,
  'a WAF signature on a passing check is refused'
);
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, waf)
    values ('00000000-0000-0000-0000-0000000000d1', 'SIN', now(), 'blocked', 403, 'imperva')$$,
  '23514', null,
  'only known WAF vendors are stored'
);
select lives_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, control_ok)
    values ('00000000-0000-0000-0000-0000000000d1', 'BKK', now(), 'pass', 200, false)$$,
  'a Bangkok check records a failed control check'
);

select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, control_ok)
    values ('00000000-0000-0000-0000-0000000000d1', 'SIN', now(), 'pass', 200, true)$$,
  '23514', null,
  'only a Bangkok check carries the control result'
);

-- D-027 rule 2b: the Akamai control, Bangkok only.
select lives_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, akamai_ok)
    values ('00000000-0000-0000-0000-0000000000d1', 'BKK', now(), 'fail', 503, false)$$,
  'a Bangkok check records a failed Akamai control'
);
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, akamai_ok)
    values ('00000000-0000-0000-0000-0000000000d1', 'TYO', now(), 'pass', 200, true)$$,
  '23514', null,
  'only a Bangkok check carries the Akamai control'
);

-- A partition the nightly job creates later carries the constraints too.
select private.manage_check_results_partitions(now() + interval '3 months');
select throws_ok(
  $$insert into public.check_results (monitor_id, location, checked_at, outcome, status_code, waf)
    values ('00000000-0000-0000-0000-0000000000d1', 'SIN', now() + interval '3 months', 'pass', 200, 'akamai')$$,
  '23514', null,
  'a future partition refuses a WAF signature on a passing check'
);

-- D-028: the BKK control alert is a known system alert kind.
select isnt(public.open_system_alert('bkk_control_failing', '{}'), null, 'bkk_control_failing opens');
select is(
  (select count(*)::int from public.notifications n join public.system_alerts a on a.id = n.system_alert_id
    where a.kind = 'bkk_control_failing' and n.template = 'bkk_control_failing'),
  (select count(*)::int from public.profiles where role = 'admin' and is_active),
  'every active Admin gets the email'
);

select * from finish();
rollback;
