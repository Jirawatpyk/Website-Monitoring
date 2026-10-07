-- S03: Bangkok joins the vote. The VPS agent posts its results through /api/ingest, which stamps
-- probe_locations.last_heartbeat_at; the engine expects only active locations that beat in the
-- last 3 min (D-019), so an environment whose agent isn't running yet keeps deciding on SIN + TYO.
update public.probe_locations set is_active = true where code = 'BKK';
