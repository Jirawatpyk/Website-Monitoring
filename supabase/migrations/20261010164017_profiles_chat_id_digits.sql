-- A Google Chat user id is the number in `users/<id>` — digits only (access/chat-ids.template.sql). The
-- notifier writes the mention as `<users/<id>>`, so an id saved with its `users/` prefix posts
-- `<users/users/…>` and nobody is mentioned (S08 staging run, 10 Oct 2026). Refuse it at the source.
-- `not valid`: every new or changed id is checked; existing rows aren't scanned, so a stray value in a
-- hosted project can't fail `migrate-production` — fix it with the template, then validate.
alter table public.profiles
  add constraint profiles_google_chat_user_id_digits
  check (google_chat_user_id ~ '^[0-9]+$') not valid;
