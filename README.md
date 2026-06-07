# Redirect Sentinel

A free web app that **audits HTTP redirects** for an AEM + Akamai setup and
**validates them against a spec sheet**. Given a source URL and an expected
target, it confirms the live redirect actually lands on the expected target and
captures the full hop chain (status, timing, and an Akamai/AEM/origin tag per
hop). It’s a redirect *contract test*.

Built to the brief in [`CLAUDE.md`](./CLAUDE.md). Deploy steps:
[`DEPLOY.md`](./DEPLOY.md).

## What it does

- **Two input modes:** paste URLs (trace only), or upload an `.xlsx`/`.csv`
  rules sheet (Rule Name · Source URL · Expected Target, with a column-mapping
  confirmation step). Extra columns are carried through to the export.
- **Strict verdict:** PASS/FAIL is decided **only** by final URL vs expected
  target (exact). Status codes and hop count are shown as info but never change
  the verdict. FAILs are tagged with *why* — trivial diff, real mismatch, no
  redirect, broken, or loop.
- **WAF-friendly engine:** the Akamai WAF rate-limits by volume, so large
  inputs are auto-chunked (~30/batch, low concurrency, cooldown between
  batches). Realistic browser-like headers close most of the gap.
- **Playwright fallback:** if the HTTP engine is blocked (`403`/`429`), those
  URLs are re-checked from a GitHub Actions runner (fresh IP + real browser);
  results merge back into the report automatically.
- **Tiered auth:** ≤10 URLs need no login; logged-in limits are
  basic 30 / advanced 55 / admin 100 / owner unlimited — enforced server-side.
- **Archive + history:** every audit is committed (JSON + CSV) to a separate
  reports repo in a UTC `YYYY/MM/DD/` tree; any logged-in user can browse and
  re-render past reports in-app.

## Architecture

| Piece | Where | Role |
|-------|-------|------|
| Static frontend | `public/` | UI (no framework, no build step) |
| `audit-background` | `netlify/functions/` | HTTP engine, batching, verdict, archival, dispatch |
| `get-report` / `list-reports` | `netlify/functions/` | token-holding read proxy + history |
| shared logic | `netlify/functions/lib/` | engine, batch, verdict, servertag, auth, github, report |
| `deep-check.yml` + `deepcheck.mjs` | `.github/` | Playwright fallback on Actions |

See the data-flow diagram and full setup in [`DEPLOY.md`](./DEPLOY.md).

## API (`POST /api/check`)

A synchronous endpoint for non-browser callers (scripts, the Claude API with
tool-use, an MCP server, or Claude.ai chat fetching a link). Runs the same engine
+ strict verdict model and returns results **inline** — no login, no archival, no
polling. Up to **75 URLs per call**, bounded by an overall ~8s time budget so it
never times out (URLs unfinished by then come back BLOCKED; use the in-app audit
flow for larger/slower sets).

```bash
# Single URL (quick status / redirect trace)
curl "https://<your-site>/api/check?url=https://www.example.com/old-page"

# Whole list in ONE GET — comma-separated, add &format=md for a readable summary
curl "https://<your-site>/api/check?format=md&urls=https://ex.com/a,https://ex.com/b,https://ex.com/c"

# Contract check — does each source land on its expected target? (POST)
curl -X POST https://<your-site>/api/check \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"source":"https://ex.com/a","expected":"https://ex.com/b","ruleName":"R1"}]}'
```

JSON response: `{ count, summary:{checked,passed,failed,blocked}, results:[{ source,
expected, finalUrl, finalStatus, hopCount, verdict, reason, error, hops:[...] }] }`.
`&format=md` returns a readable text summary (verdict + hop chain) instead. CORS-open.

## Use it from Claude

- **Claude.ai chat — no connector, whole batch in one go.** The `urls=` GET takes
  up to 75 comma-separated URLs, so Claude makes a *single* fetch for a pasted
  list. Give it this once (e.g. in a Project, or just in the message):

  > To check redirects, make ONE web fetch to
  > `https://<your-site>/api/check?format=md&urls=URL1,URL2,…` (URL-encoded,
  > up to 75), then summarise the result and flag any FAIL / BLOCKED rows. For
  > more than 75 URLs, tell me to use the web app.

  Trace-only (no expected-target contract check via GET); needs web browsing on.
- **Claude.ai chat — custom connector.** A stateless MCP Streamable-HTTP endpoint
  lives at **`/mcp`**. Add it in Claude.ai → **Settings → Connectors → Add custom
  connector** → `https://<your-site>/mcp` (Pro/Max/Team/Enterprise). Exposes the
  `check_redirects` tool, incl. strict contract checks (up to 75 URLs).
- **Read a finished audit in chat.** Any archived report renders as text for a
  single fetch: `https://<your-site>/api/report?path=YYYY/MM/DD/<file>.json&format=md`.
- **Claude Desktop / Claude Code.** Local (stdio) MCP server — see [`mcp/`](./mcp/).

## Develop

```bash
npm test     # 25 unit tests over verdict / servertag / batching / auth / report
```

> **One deliberate deviation from the brief:** the brief puts Excel/CSV parsing
> in the Function. Because the column-mapping confirmation needs a client-side
> preview, we parse in the browser (SheetJS) to drive the mapping UI and send
> structured rows to the Function — which still owns all *logic* (verdict,
> limits, tagging, archival). This keeps the Function dependency-free.

## License

MIT
