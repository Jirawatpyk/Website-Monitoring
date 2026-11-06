-- S14: validate the notifications subject check added `not valid` in 20261106055318_reports.sql —
-- a separate file, so the scan doesn't run under that file's ACCESS EXCLUSIVE lock (supabase/CLAUDE.md).
set local lock_timeout = '5s';

alter table public.notifications validate constraint notifications_one_subject;
