-- DxT Monitor · 0001 — extensions and enums.
-- Enum values mirror packages/shared/src/domain.ts; change both together.
-- Tables (PRD §11) come in later migrations, one concern each, every table with RLS enabled.

create extension if not exists pg_cron;   -- partitions, rollups, retention (PRD §11)
create extension if not exists pgmq;      -- notification + verifier queues (PRD §10)

create type public.app_role as enum ('admin', 'responder', 'stakeholder', 'viewer', 'client');

create type public.site_status as enum ('ok', 'problem', 'down', 'maintenance');

create type public.severity as enum ('problem', 'down');

create type public.incident_state as enum (
  'unacked', 'escalated', 'acknowledged', 'monitoring',
  'needs_root_cause', 'resolved', 'in_review', 'closed'
);

create type public.incident_trigger as enum (
  'hard_fail', 'blocked_unverified', 'slow', 'keyword', 'key_page',
  'ssl', 'domain', 'redirect', 'regional', 'manual'
);

create type public.check_outcome as enum ('pass', 'fail', 'blocked');

create type public.monitor_type as enum ('http', 'keyword', 'ssl', 'domain', 'browser');

create type public.notification_channel as enum ('google_chat', 'email', 'voice');

-- PRD §11 lists queued / sent / failed; `cancelled` records an Undo inside the hold_until window.
create type public.notification_status as enum ('queued', 'sent', 'failed', 'cancelled');
