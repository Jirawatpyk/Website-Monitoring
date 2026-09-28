# apps/vps-agent

Runs on the Thai VPS (2 GB, systemd unit in `deploy/`). Two jobs: the Bangkok probe loop (every minute) and the Playwright browser verifier.

- Talks **only** to the web app's `/api/ingest` and `/api/jobs` with `INGEST_TOKEN`. It never gets a database key (PRD §10).
- HTTP checks use `runHttpCheck` from `@dxt/probe` so Bangkok judges responses exactly like Singapore and Tokyo.
- Verifier: plain Chromium, no stealth plugin, 20 s per page, at most 3 sessions, screenshots to Supabase Storage via the Job API (PRD §5).
- Pings Healthchecks.io after every loop; a missed ping > 3 min emails Tao only (spec §15.3).
- `pnpm dev:agent` runs with `tsx watch`; `pnpm --filter @dxt/vps-agent build` bundles with tsup (workspace packages inlined).
