-- D-050: a site whose timeouts keep coming back one round at a time (timeout, OK, timeout…, D-049's
-- accepted gap) is a PROBLEM with its own trigger, "Intermittent". Its own file: a new enum value
-- can't be used in the transaction that adds it. packages/shared TRIGGERS mirrors this enum.

alter type public.incident_trigger add value if not exists 'intermittent';
