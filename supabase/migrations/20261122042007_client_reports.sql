-- S20 (FR-15, D-072, D-073): the monthly client report. A draft per client and month, made on the 1st
-- at 06:00 Bangkok by the reports cron: the figures it was rendered from and the PDF in a private
-- bucket. Sending it to the client is S20b; until then a draft is only read by staff.

create table public.client_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete restrict,
  -- The Bangkok month reported, as its first day.
  month date not null check (extract(day from month) = 1),
  -- What the PDF says (clientMonth + per-site lines), kept so the page needn't re-read the month.
  figures jsonb not null check (jsonb_typeof(figures) = 'object'),
  -- The PDF in the `client-reports` bucket: always `<this client id>/<this YYYY-MM>.pdf`, so a row can
  -- never point at another client's file (security review L1).
  storage_path text not null check (
    storage_path = client_id::text || '/' || extract(year from month)::int::text || '-'
      || lpad(extract(month from month)::int::text, 2, '0') || '.pdf'
  ),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_reports_once unique (client_id, month)
);

create trigger client_reports_set_updated_at before update on public.client_reports
  for each row execute function private.set_updated_at();

alter table public.client_reports enable row level security;

-- Every staff role reads (PRD §3: the staff dashboards and reports; D-072); only the reports cron
-- (service role) writes. The Phase 3 client role reads nothing here until it has its own policy.
create policy client_reports_select_staff on public.client_reports
  for select to authenticated
  using ((select public.is_staff()));

revoke all on public.client_reports from public, anon, authenticated;
grant select on public.client_reports to authenticated;
grant all on public.client_reports to service_role;

-- ── The PDF bucket ────────────────────────────────────────────────────────────────────────────────
-- Private, PDF only, 5 MB at most. No policies for people: the cron uploads with the service role and
-- the app serves a file only after its own staff check (the PDF route), like the verifier screenshots.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-reports', 'client-reports', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
