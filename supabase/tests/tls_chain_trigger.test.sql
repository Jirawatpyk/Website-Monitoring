-- D-029: the tls_chain trigger is a valid incident_trigger, stored on incidents and monitor_status.
begin;
\ir _helpers.psql
select plan(3);

select tests.clear_sites();
insert into public.clients (id, name) values ('00000000-0000-0000-0000-0000000000c9', 'Client T');
insert into public.sites (id, client_id, name, tier) values
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000c9', 'Site T', 2);
insert into public.monitors (id, site_id, type, is_primary, url) values
  ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000a9', 'http', true,
   'https://t.pgtap.test');

select is('tls_chain'::public.incident_trigger::text, 'tls_chain', 'tls_chain is an incident trigger');
select lives_ok(
  $$insert into public.incidents (site_id, monitor_id, state, severity, episode_severity, trigger, started_at, detected_at)
    values ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000d9', 'unacked',
            'problem', 'problem', 'tls_chain', now(), now())$$,
  'an incident opens with the tls_chain trigger'
);
select lives_ok(
  $$insert into public.monitor_status (monitor_id, site_id, last_round_at, status, trigger, cause)
    values ('00000000-0000-0000-0000-0000000000d9', '00000000-0000-0000-0000-0000000000a9', now(), 'problem', 'tls_chain', 'TLS chain misconfigured')$$,
  'a monitor shows PROBLEM with the tls_chain trigger'
);

select * from finish();
rollback;
