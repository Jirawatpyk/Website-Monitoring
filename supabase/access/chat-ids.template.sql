-- DxT Monitor · Google Chat ids (D-015). TEMPLATE — placeholders only; never commit real ids or addresses.
--
-- A site's owner and backup need a Google Chat user id before they can be assigned (S05, D-025), and the
-- alerts @mention only people who have one. Until the Profile screen (S16) an Admin sets them here, per
-- environment, in that Supabase project's SQL editor. The person must have signed in once (that creates
-- their profile). The id is the number in the person's Chat user resource `users/<id>` (Google Chat →
-- their profile, or the Admin console / People API) — digits only, no `users/` prefix.

update public.profiles p
set google_chat_user_id = v.chat_id
from (values
  (lower('<first.last>@<company-domain>'), '<digits>'),
  (lower('<first.last>@<company-domain>'), '<digits>')
) as v(email, chat_id)
where p.email = v.email;

-- Check: everyone who can own a site, and who still has no id
-- select display_name, email, role, google_chat_user_id is not null as linked
-- from public.profiles where is_active and role in ('admin', 'responder') order by display_name;
