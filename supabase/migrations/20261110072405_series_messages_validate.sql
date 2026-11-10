-- S14 PR 2b: validate the one-subject check the series migration re-added NOT VALID (as reports_validate).
set local lock_timeout = '5s';
alter table public.notifications validate constraint notifications_one_subject;
