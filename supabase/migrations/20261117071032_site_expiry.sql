-- S13 (FR-11, D-066): site_expiry — when each live site's SSL certificate and domain expire.
-- A sin1 cron reads the primary monitor's host certificate (TLS handshake, dates only) and the
-- registrable domain's expiry (RDAP, or WHOIS for .co / .jp) every day at 06:00 Bangkok, and every
-- hour for a site whose last read failed, is a day old or has an expiry PROBLEM open. One current
-- row per site, upserted: only today's date matters, so no history (17 rows).
--
-- Each half keeps its last good read (`*_expires_at` … `*_read_at`) beside its latest attempt
-- (`*_checked_at`, `*_error`): a failed attempt never wipes the date, and the engine treats it as no
-- data — it holds an open expiry PROBLEM and never opens one (D-066).

create table public.site_expiry (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null unique references public.sites (id) on delete cascade,
  -- the primary monitor's host the certificate was read from, and its registrable domain
  host text not null check (char_length(host) between 1 and 253),
  domain text check (char_length(domain) between 1 and 253),

  ssl_expires_at timestamptz,
  ssl_valid_from timestamptz,
  -- the issuer's organisation, e.g. "Let's Encrypt"
  ssl_issuer text check (char_length(ssl_issuer) <= 200),
  ssl_read_at timestamptz,
  ssl_checked_at timestamptz,
  ssl_error text check (char_length(ssl_error) <= 300),

  domain_expires_at timestamptz,
  domain_source text check (domain_source in ('rdap', 'whois')),
  domain_read_at timestamptz,
  domain_checked_at timestamptz,
  domain_error text check (char_length(domain_error) <= 300),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- a good read has its date (and its start / source); none without one
  constraint site_expiry_ssl_read check (
    (ssl_read_at is null) = (ssl_expires_at is null) and (ssl_read_at is null) = (ssl_valid_from is null)
  ),
  constraint site_expiry_domain_read check (
    (domain_read_at is null) = (domain_expires_at is null) and (domain_read_at is null) = (domain_source is null)
  )
);

create trigger site_expiry_set_updated_at before update on public.site_expiry
  for each row execute function private.set_updated_at();

alter table public.site_expiry enable row level security;

-- Like crawler_checks: staff read, only the collector (service role) writes.
create policy site_expiry_select_staff on public.site_expiry
  for select to authenticated
  using ((select public.is_staff()));

revoke all on public.site_expiry from public, anon, authenticated;
grant select on public.site_expiry to authenticated;
grant all on public.site_expiry to service_role;
