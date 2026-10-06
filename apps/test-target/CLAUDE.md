# apps/test-target

A switchable site for staging checks (S02a), deployed as its own Vercel project `dxt-test-target`
(root `apps/test-target`) so it never depends on the app it helps test. Every path answers by the
`mode` item in the Edge Config store connected to the project (env `EDGE_CONFIG`): `ok` → 200,
`error` → 500, `timeout` → held 45 s. Point the staging test monitor at it
(`supabase/staging/test-target.sql`) and flip `mode` to trigger a DOWN / RECOVERED.

No secrets, no data, no auth: it only says which mode it is in.
