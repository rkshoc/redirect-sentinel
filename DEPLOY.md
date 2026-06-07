# Deploy guide — Redirect Sentinel

Everything here is doable from a browser (GitHub web UI + Netlify dashboard).
No local toolchain required (CLAUDE.md §11).

There are **two repos**:

| Repo | Visibility | Purpose |
|------|-----------|---------|
| `redirect-sentinel` | **public** | the app + the Playwright workflow (public = unlimited Actions minutes) |
| `redirect-sentinel-reports` | private (recommended) | archived audit reports (JSON + CSV) |

> No secrets ever live in either repo. Tokens live in Netlify env vars and a
> GitHub Actions secret (CLAUDE.md §4).

---

## 1. Create the repos

1. Push this project to **`redirect-sentinel`** (public).
2. Create **`redirect-sentinel-reports`** and tick **“Add a README”** when
   creating it — this gives the repo a `main` branch so the Contents API can
   write into it. (Writing to a deep path like `2026/06/04/…` auto-creates the
   folders; CLAUDE.md §8.)

## 2. Create ONE GitHub token (fine-grained PAT)

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate.

- **Repository access:** select **both** repos above.
- **Permissions:**
  - Reports repo → **Contents: Read and write**
  - App repo → **Actions: Read and write** (to dispatch the deep-check workflow)
- Copy the token. You’ll paste it in two places below.

## 3. Add the token to GitHub Actions (for the Playwright write-back)

App repo → Settings → Secrets and variables → **Actions** → New repository secret:

- `REPORTS_TOKEN` = the PAT from step 2.

(The default `GITHUB_TOKEN` can’t write to the *separate* reports repo, so the
deep-check job uses this PAT.)

## 4. Deploy on Netlify

1. Netlify → **Add new site → Import an existing project** → pick
   `redirect-sentinel`. Build settings are read from `netlify.toml`: Netlify runs
   `npm install` + `npm run build` (Vite/React) and publishes the `dist/` output;
   functions come from `netlify/functions/`. You don't need to type anything —
   the build command, publish dir, and Node version are pinned in `netlify.toml`.
2. After the first deploy, go to **Site settings → Environment variables** and add:

   | Variable | Value | Notes |
   |----------|-------|-------|
   | `GITHUB_TOKEN` | the PAT from step 2 | committing reports + dispatching Actions |
   | `REPORTS_OWNER` | your GitHub username/org | e.g. `rkshoc` |
   | `REPORTS_REPO` | `redirect-sentinel-reports` | default already this |
   | `REPORTS_BRANCH` | `main` | optional |
   | `APP_OWNER` | your GitHub username/org | defaults to `REPORTS_OWNER` |
   | `APP_REPO` | `redirect-sentinel` | optional |
   | `APP_BRANCH` | `main` | **must be the branch holding `deep-check.yml`** |
   | `DEFAULT_BASE_URL` | e.g. `https://www.example.com` | optional; resolves relative source/target paths |
   | `BATCH_SIZE` | `30` | optional WAF tuning — per-domain burst ceiling (CLAUDE.md §3) |
   | `BATCH_CONCURRENCY` | `4` | optional — per-domain in-flight requests |
   | `BATCH_COOLDOWN_MS` | `4000` | optional — pause between per-domain batches |
   | `MAX_IN_FLIGHT` | `16` | optional — global cap across *all* domains (mixed-domain inputs fan out to here) |
   | `HOP_TIMEOUT_MS` | `12000` | optional |

3. **Re-deploy** so the functions pick up the env vars.

## 5. Enable Netlify Identity (auth + tiers)

1. Site → **Identity → Enable Identity**.
2. **Registration:** set to **Invite only** (internal tool, ~30 users).
3. Invite users (Identity → Invite users).
4. **Assign roles** so tier limits apply (CLAUDE.md §4). Identity → click a
   user → set the **Roles** field (this populates `app_metadata.roles`, which
   the Function reads). Use one of:

   | Role | URL limit |
   |------|-----------|
   | `basic` | 30 |
   | `advanced` | 55 |
   | `admin` | 100 |
   | `owner` | unlimited |

   No role = treated as `basic` (30). Not logged in = **≤10 URLs** (no login
   needed for small checks).

> The Identity widget is already wired into the app (`index.html`). It
> auto-discovers the Identity API on the same domain once Identity is enabled.

## 6. Verify

- Open the site. Without logging in, paste ≤10 URLs and **Run audit** — you
  should get a report, and a file should appear in the reports repo under
  `YYYY/MM/DD/`.
- Log in, upload a sheet of >10 rows, confirm the limit matches your role.
- Open **History**, drill into today’s folder, click the audit — it re-renders.
- To exercise the fallback: when the HTTP engine hits a `403`/`429`, the app
  marks those rows **DEEP-CHECK**, dispatches `deep-check.yml`, and the row
  resolves automatically once the workflow writes its companion file.

---

## How the pieces talk

```
Browser ─GET /api/whoami─▶ whoami (sync) ─ Identity clientContext ─▶ signed identity token
   │                                                                         │
   ├─POST /api/audit (carries the signed token) ─▶ audit-background (worker)─┘
   │                                                  │  verify token + tier limit
   │                                                  │  trace + batch + verdict
   │                                                  ├─▶ commit JSON+CSV ─▶ reports repo
   │                                                  └─▶ workflow_dispatch ─▶ deep-check.yml
   │                                                                              │ Playwright
   │                                                                              └─▶ <base>.deepcheck.json
   └──poll /api/report?path=…──▶ get-report ──reads base + merges companion──▶ render
```

> Netlify does **not** populate Identity's `clientContext.user` for background
> functions, and only executes them on a direct browser trigger. So the browser
> first calls the sync `/api/whoami` (where Identity works) to get a short-lived
> **server-signed identity token**, then calls the worker directly with it. The
> worker verifies the token (HMAC over `INTERNAL_TOKEN`, which falls back to
> `GITHUB_TOKEN` — no extra setup needed), keeping tier limits un-forgeable.

## Notes, limits & cost

- **Why a background function.** A standard sync function caps at ~10s — not
  enough to batch hundreds of URLs with cooldowns. `audit-background` is a
  **Netlify Background Function** (15-min limit), available on all current
  Netlify plans within the free usage tier (125k invocations / 100 runtime
  hours per month — ample for ~30 internal users). It returns `202` instantly;
  the browser **polls** `/api/report` for the result, which is also why the
  report can render in a **partial/pending** state while deep-checks run.
- **Limit feedback.** Because background functions answer `202` immediately, the
  browser enforces tier limits up-front for clean messaging, and the Function
  re-checks server-side and simply **won’t produce a report** for an over-limit
  request that bypassed the UI (CLAUDE.md §4). Identity (and therefore the role)
  is always verified server-side from the Netlify Identity JWT.
- **Tuning the WAF batching** is purely via the optional env vars in step 4
  (`BATCH_SIZE` / `BATCH_CONCURRENCY` / `BATCH_COOLDOWN_MS` / `MAX_IN_FLIGHT`).
  The first three pace requests **per domain** (defaults 30 / 4 / 4000ms sit
  safely under the observed ~40 ceiling); `MAX_IN_FLIGHT` (default 16) caps total
  simultaneous requests **across all domains**. Because the Akamai WAF counts
  per-property, a mixed-domain audit fans out up to `MAX_IN_FLIGHT` while each
  individual domain still stays paced — large mixed lists finish far faster than
  a same-size single-domain list, which remains deliberately throttled (CLAUDE.md §3).

## Local dev (optional)

Not required (the app deploys from the browser via Netlify), but if you have
Node 18+ locally:

```
npm install              # install React/Vite/Tailwind + tooling
npm run dev              # Vite dev server (frontend only, hot reload)
npm run build            # production build into dist/ (what Netlify runs)
npm test                 # run the backend unit tests (node --test)
npx netlify dev          # serve functions + frontend together (needs Netlify CLI)
```
