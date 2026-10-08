-- S05b (D-027): check_results.waf and control_ok — a WAF signature only on a blocked check.
begin;
\ir _helpers.psql
select plan(6);

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

select * from finish();
rollback;
