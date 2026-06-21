# Redirect Sentinel — Chrome extension

A dedicated audit page in your browser: paste URLs **or** upload an Excel/CSV,
run the scan, and see verdicts + full hop chains. The scan runs on the same
Redirect Sentinel backend you already deployed — it fires the **Playwright /
GitHub Actions** engine and polls for the result, so no auditing happens in the
browser itself.

## Install (unpacked — no store listing needed)

1. Open **`chrome://extensions`**.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select this **`extension/`** folder.
4. Click the Redirect Sentinel toolbar icon → the audit page opens in a tab.
   (It also opens automatically right after install.)

## First-time setup

Open **Settings** on the page and set:

- **Site URL** — your deployed Redirect Sentinel, e.g. `https://your-site.netlify.app`.
- **Log in** (optional) — your Netlify Identity email + password. Required only
  to audit **more than 10 URLs**; up to 10 works without logging in. The tier
  limit (basic/advanced/admin/owner) is still enforced **server-side**.

Settings are stored locally via `chrome.storage` — no tokens are bundled in the
extension.

## Use

- **Paste URLs:** one per line. To check against an expected target, put it after
  a comma or tab: `https://site/old, https://site/expected-new`.
- **Upload Excel/CSV:** pick the file, confirm the detected **Rule / Source /
  Expected** columns, then run. Parsing happens locally (SheetJS); only the
  rows are sent to your backend.
- Results show PASS / FAIL (+ reason) / BLOCKED, the final URL, and the full hop
  chain with Akamai/AEM server tags. Export to CSV or JSON.

## How it talks to the backend

```
extension  ──POST /api/audit-dispatch──▶  Netlify (auth + tier limit, stages input)
                                              └─ workflow_dispatch ─▶ GitHub Actions (Playwright)
extension  ──GET  /api/report?path=…──▶   polls until the report is written ──▶ render
```

The extension needs `host_permissions` for your site (the manifest allows
`https://*/*` so any deployment works); narrow it to your domain if you prefer.

## Notes

- A real-browser scan on a fresh runner takes ~1–2 min for the first run (runner
  cold start); large batches are paced to stay under the Akamai WAF volume limit.
- The same audit is archived to your reports repo and shows up in the web app's
  History, since both share one backend.
