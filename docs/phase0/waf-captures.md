# Phase 0 — WAF / bot-block captures (S00 Done-when 5)

Captured 5 Oct 2026 from a Thai residential IP with `curl`. Raw responses sit next to this file. These feed the `blocked` classification in `packages/probe` (a block is neither OK nor DOWN — the browser verifier decides, spec §6).

Limit: the Vercel probes (`probe-sin`, `probe-tyo`) call from data-centre IPs, which bot protection often treats more strictly. Re-check with the real probes in S02a and add any new signature here.

## Results

| Site | Edge | `DxT-Monitor/1.0` | Other UAs | Verdict |
| --- | --- | --- | --- | --- |
| Bangkok Airways – Taiwan / China | Akamai | **403** | 403 for every non-browser request; a real signed-in browser loads | Blocked — needs the client's allowlist (deferred, not requested yet) |
| Cando Asia | nginx (WordPress + LiteSpeed) | 200 | **403 for `python-requests/2.31`**; 200 for curl / no UA; 15 requests in a row all 200 | UA filter only — our UA passes |
| Tubtong | Cloudflare | 200 | 200 for every UA tried; 15 requests in a row all 200 | No block seen from a Thai IP |

## Signatures for `packages/probe`

| Signature | Match on | Raw sample | Notes |
| --- | --- | --- | --- |
| Akamai access denied | status 403 **and** header `Server: AkamaiGHost` (or an `Akamai-GRN` header) **and** body contains `Access Denied` | [`bangkokair-403.txt`](bangkokair-403.txt) | Strong signal: Akamai only sends this page when its rules reject the client. |
| nginx default 403 | status 403, `Server: nginx`, body is nginx's default page (`<title>403 Forbidden</title>`, ~146 bytes) | [`cando-asia-403.txt`](cando-asia-403.txt) | Weak signal on its own — a real misconfiguration returns the same page. Treat as `blocked` only for monitors flagged as WAF-protected, otherwise as a hard fail. |
| Cloudflare challenge | status 403 / 503 with `Server: cloudflare` and `cf-mitigated: challenge` (or a `Just a moment...` page) | — (not reproduced) | Not seen on Tubtong; add a capture if the Vercel probes hit it. |
