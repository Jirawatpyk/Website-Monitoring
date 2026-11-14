-- S16 PR 4: validate the one-subject check the account-events migration re-added NOT VALID (as series_messages_validate).
set local lock_timeout = '5s';
alter table public.notifications validate constraint notifications_one_subject;
