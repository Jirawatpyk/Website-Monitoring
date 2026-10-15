-- S09d (D-041, D-046): a home page whose fingerprint differs from its accepted baseline is a PROBLEM
-- with its own trigger, "Page change". Its own file: a new enum value can't be used in the transaction
-- that adds it, and the next migration's functions name it. packages/shared TRIGGERS mirrors this enum.

alter type public.incident_trigger add value if not exists 'content_change';
