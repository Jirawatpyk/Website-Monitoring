-- S10 PR B0: validate the notifications subject check added `not valid` in 20261029105753_oncall.sql —
-- a separate file, so the scan doesn't run under that file's ACCESS EXCLUSIVE lock (supabase/CLAUDE.md).
set local lock_timeout = '5s';

alter table public.notifications validate constraint notifications_one_subject;
