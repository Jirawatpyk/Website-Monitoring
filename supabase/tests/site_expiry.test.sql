-- S13 (D-066): site_expiry — RLS (staff read, nobody but the service role writes) and its checks.
begin;
\ir _helpers.psql
select plan(13);

select tests.clear_sites();
create temp table ids (name text primary key, id uuid) on commit drop;
grant select on ids to anon, authenticated;
insert into ids values
  ('arm',  tests.create_user('arm@pgtap.test', 'responder')),
  ('mint', tests.create_user('mint@pgtap.test', 'viewer')),
  ('cli',  tests.create_user('cli@pgtap.test', 'client'));

insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Client A');
insert into public.sites (id, client_id, name, tier, primary_owner_id, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'Live', 1,
   (select id from ids where name = 'arm'), true);
insert into public.site_expiry (site_id, host, domain, ssl_expires_at, ssl_valid_from, ssl_read_at, ssl_checked_at,
  domain_expires_at, domain_source, domain_read_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'www.a.pgtap.test', 'a.pgtap.test',
   now() + interval '20 days', now() - interval '70 days', now(), now(),
   now() + interval '200 days', 'rdap', now());

select throws_ok(
  $$insert into public.site_expiry (site_id, host) values ('00000000-0000-0000-0000-0000000000a1', 'x.test')$$,
  '23505', null, 'one row per site'
);
select throws_ok(
  $$update public.site_expiry set ssl_expires_at = null$$,
  '23514', null, 'a good SSL read has its date'
);
select throws_ok(
  $$update public.site_expiry set domain_source = 'dns'$$,
  '23514', null, 'the domain source is RDAP or WHOIS'
);
select throws_ok(
  $$update public.site_expiry set domain_expires_at = null$$,
  '23514', null, 'a good domain read has its date'
);
select throws_ok(
  $$update public.site_expiry set domain_source = null$$,
  '23514', null, 'and its source'
);
select throws_ok(
  $$update public.site_expiry set ssl_error = repeat('x', 301)$$,
  '23514', null, 'an error is at most 300 characters'
);

-- ── Who reads ─────────────────────────────────────────────────────────────
select tests.authenticate_as((select id from ids where name = 'arm'));
select is((select count(*)::int from public.site_expiry), 1, 'a Responder reads the row');
select throws_ok(
  $$update public.site_expiry set ssl_error = 'x'$$,
  '42501', null, 'staff never write'
);
select throws_ok(
  $$insert into public.site_expiry (site_id, host) values (gen_random_uuid(), 'x.test')$$,
  '42501', null, 'staff never insert'
);
select tests.authenticate_as((select id from ids where name = 'mint'));
select is((select count(*)::int from public.site_expiry), 1, 'a Viewer reads the row');
select tests.authenticate_as((select id from ids where name = 'cli'));
select is((select count(*)::int from public.site_expiry), 0, 'a client account reads nothing');

select tests.as_anon();
select throws_ok($$select * from public.site_expiry$$, '42501', null, 'anon is refused');
reset role;

delete from public.sites where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*)::int from public.site_expiry), 0, 'the row goes with its site');

select * from finish();
rollback;
