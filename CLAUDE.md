# Redirect Sentinel — Project Spec & Build Brief

> Handoff brief for Claude Code. This file is the source of truth for the project. Read it fully before writing code. Decisions below are settled — implement them, don't re-litigate them unless you spot a genuine technical blocker (if so, flag it).

---

## 1. What we're building

A free web app that **audits HTTP redirects** for an organisation's **AEM + Akamai** setup and **validates them against a spec sheet**. It's a redirect *contract test*: given a source URL and an expected target, confirm the live redirect actually lands on the expected target, and capture the full hop chain.

- **Users:** ~30 internal users.
- **Cost constraint:** must run effectively free.
- **URLs audited are publicly reachable** (no VPN/intranet).
- Redirects are server-side (Akamai edge + AEM dispatcher/publish) — i.e. HTTP 301/302/307/308, **not** JS-based in the common case.

---

## 2. Tech stack (settled)

- **Host + UI:** Netlify (static frontend + Netlify Functions).
- **Primary engine:** Netlify Function doing HTTP redirect-following (`undici`/fetch with manual redirect handling). Fast, free.
- **Fallback engine:** Playwright on **GitHub Actions** (public repo for unlimited minutes), triggered only when the HTTP attempt is blocked. **Playwright must NOT run inside Netlify Functions** (too heavy / no browser binary).
- **Auth:** Netlify Identity (roles → limits).
- **Archive:** a **separate GitHub "reports" repo**, written to by the Netlify Function via the GitHub Contents API.
- **Frontend:** keep it framework-light (plain HTML/CSS/JS or a small React build is fine). A static visual mockup already exists and was approved — match its layout/verdict model. Dark theme, IBM Plex Mono / Fraunces fonts, Akamai-orange / AEM-blue accent system.

Two repos:
- `redirect-sentinel` — the app (public, so Actions minutes are unlimited; **no secrets in the repo** — use Actions secrets / Netlify env).
- `redirect-sentinel-reports` — archived audit reports.

---

## 3. The two-tier engine + the WAF constraint (important)

**Observed behaviour:** sending ~30–40 URLs in one burst works fine; **50–60+ triggers Akamai 403s.** This is **volume-based rate limiting**, NOT bot-fingerprint detection. (Confirmed by the fact that low volumes pass — fingerprint blocking would block from request #1.)

Implications:
- **Batching is the main fix.** Chunk large inputs into batches of ~30 (configurable, default safely under the ~40 ceiling). Low concurrency within a batch (3–5). A short cooldown (a few seconds) between batches. Total request count per window is what trips the WAF.
- **IP allowlisting is NOT available** — the user cannot allowlist IPs in Akamai. So we cannot remove the throttle that way.
- **Playwright fallback's real value here is a different IP** (GitHub runners) plus the ability to solve any JS challenge. On an HTTP `403`/challenge that batching can't clear, fall back to the Playwright-on-Actions path for those URLs. Apply the same batching discipline on the Actions side.
- Use **realistic browser-like headers** in HTTP mode (full User-Agent, Accept, Accept-Language, Sec-Fetch-*) — cheap, closes most of the gap with a real browser.

**Flow:** HTTP attempt first → on block, dispatch GitHub Actions (`workflow_dispatch` via Octokit) for the blocked URLs → Playwright re-checks from a fresh IP → results returned async → UI polls and merges them, flagged as "deep-checked". The fallback is slow (Actions cold start 30s–2min) so the report must support a **partial/pending state** while deep-checks run.

---

## 4. Auth & tiers (enforce SERVER-SIDE in the Function — never in the browser)

- **≤10 URLs:** no login required.
- **>10 URLs:** must be logged in; limit depends on role:
  - basic → **30**
  - advanced → **50–60**
  - admin → **100**
  - owner (me) → **unlimited**
- **Read access to history:** ANY logged-in user can read ALL past reports, regardless of tier. (Audit *capacity* is tiered; *reading* the archive is not.) Full transparency between users is intended.

**Security notes:**
- Limits and identity checks happen inside the Netlify Function. Even if the frontend is edited, the Function rejects over-limit requests.
- Use Netlify Identity (roles/metadata per user). Do NOT use env vars as a user database. Do NOT ship any token/secret to the browser.
- The GitHub token (for committing reports + dispatching Actions) lives in Netlify env vars, scoped minimally (`workflow` + contents write to the reports repo). Browser never sees it.

---

## 5. Input

Two input modes:
1. **Paste URLs** — one per line. No expected-target check; just trace + report chains.
2. **Excel/CSV upload** — the primary mode. Columns: **Rule Name** (col A), **Source URL** (col B), **Expected Target** (col C). Cols D/E may exist (status notes etc.) — **carry them through to the export but ignore them for logic.**
   - Support `.xlsx` and `.csv`.
   - After upload, show a **column-mapping confirmation** step (detected columns + dropdowns to remap) — don't hardcode column positions.
   - Carry **Rule Name** through to the report so failures are identified by rule.

---

## 6. Verdict model (settled)

Match is decided **only by final URL vs expected target, STRICT (exact) comparison.** Status codes and hop count are captured and DISPLAYED as info, but **do NOT affect pass/fail.**

Verdicts:
- **PASS** — final URL exactly equals expected target.
- **FAIL** — final URL differs. Attach a **reason subtag** for triage:
  - *trivial difference* (differs only by trailing slash / case / protocol / www / query string)
  - *real mismatch* (genuinely different path)
  - *no redirect* (source returned 200 directly — rule not firing)
  - *broken* (final status 4xx/5xx)
  - *loop / too many hops*
- **BLOCKED** — WAF 403 / inconclusive. NOT counted as a fail (it's not a real result).

Strict means `/x` ≠ `/x/`, case-sensitive, protocol- and www-sensitive, query-sensitive. Keep the verdict strict, but classify *why* a FAIL differs so users can tell trivial noise from real bugs.

Per hop, capture & display: hop URL, status code, timing, and a **server/edge tag** — classify each hop as `Akamai edge`, `AEM dispatcher`, `AEM publish/origin`, or `unknown` by fingerprinting response headers (`Server: AkamaiGHost`, `X-Cache`, `Via`, `X-Dispatcher`, `X-Vhost`, `X-Akamai-*`). Note honestly when origin is masked by the CDN (tag `unknown`).

---

## 7. Report & output

- **Summary headline:** counts — checked / passed / failed / blocked / deep-checked.
- **Filterable table**, default **failures-first.** Filters: all, failures, blocked, "302 present", "chains > 2 hops". Search by rule/URL.
- **Per-row detail:** expected-vs-actual **diff**, reason subtag, full hop chain with status + server tags + timing.
- **Export:** the original sheet **plus appended columns** — `Actual Target`, `Verdict`, `Hop Count`, `Reason`. Offer Excel + JSON.

---

## 8. Archive (GitHub reports repo)

Every audit is committed to `redirect-sentinel-reports` in a **date-foldered tree**:

```
YYYY/MM/DD/<filename>
e.g. 2026/06/04/audit_2026-06-04T1620Z_admin_a3f9.json
```

- Folders auto-created via the GitHub Contents API (writing to a deep path creates intermediate folders).
- **Timezone: UTC** for folder dates (region-neutral, no DST ambiguity). ALSO store the user's local time in the report metadata for display.
- **One brand-new uniquely-named file per audit** — never edit existing files (avoids concurrent-write races). Filename = `audit_<UTC-timestamp>_<user>_<shortid>`.
- Save **JSON** (source of truth the app re-renders from) **+ CSV** (human-readable download) per audit.
- Optional, best-effort: a per-day index for the history view (don't let index write-races break an audit).
- Committed by the **Netlify Function**, not the browser.

**History view in-app:** any logged-in user browses by year/month/day (or searches), clicks an audit, and the tool loads its JSON and re-renders the full report. Don't make users dig through raw GitHub folders.

---

## 9. Build order (stages)

1. **Frontend scaffold** — match the approved mockup: New Audit (paste + upload + column-map), Report (summary + filters + expandable rows + hop chains), History (date tree). Wire interactions with mock data first.
2. **Netlify Function — HTTP engine** — redirect-following, realistic headers, adaptive batching/cooldown, Excel/CSV parsing, strict verdict + reason classification, header-based server tagging.
3. **Auth + tiers** — Netlify Identity, server-side limit enforcement, ≤10 no-login path, history read-for-all.
4. **GitHub archival** — Function commits JSON+CSV to the reports repo in the UTC date-folder structure; history view reads it back.
5. **Playwright fallback** — GitHub Actions workflow (public repo) + dispatch-on-block + async result merge + pending UI state.
6. **Deploy guide** — click-by-click GitHub + Netlify + Identity + env-var setup (the human will deploy from a browser; assume NO local dev environment).

---

## 10. Explicit DON'Ts

- Don't run Playwright in Netlify Functions.
- Don't enforce limits or identity in the browser.
- Don't put any secret/token in the app repo or ship it to the client.
- Don't hardcode Excel column positions (offer mapping).
- Don't let status code / hop count change the pass/fail verdict (info only).
- Don't edit existing report files (one new file per audit).
- Don't use date-only filenames (collisions) — include time + shortid + user.
- Don't try to evade bot-fingerprinting with aggressive tricks — the problem is rate-limit volume; solve it with batching + the Actions-IP fallback.

---

## 11. Build environment note

The human deploys entirely from a browser (GitHub web UI + Netlify dashboard), no local toolchain assumed. Keep setup steps browser-doable. Prefer configuration via dashboards and committed config files over anything requiring local CLI, where reasonable.
