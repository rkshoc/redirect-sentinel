# Redirect Sentinel — MCP server

A tiny [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes your deployed Redirect Sentinel's `POST /api/check` as a **tool**, so
**Claude Desktop** and **Claude Code** can audit HTTP redirects directly in a
conversation. (Consumer Claude.ai *chat* can't run MCP servers — this is for the
desktop/CLI clients and the Claude Agent SDK.)

## Tool

`check_redirects` — trace redirect chains and, when an expected target is given,
return a strict PASS / FAIL / BLOCKED contract verdict.

- `items`: `[{ source, expected?, ruleName? }]` — strict contract check
- `urls`: `["https://…", …]` — just trace chains
- `baseUrl`: optional, resolves relative paths

Handles up to **50 URLs** per call (it chunks into the endpoint's 10-per-call
limit and paces them). Larger audits belong in the app's `/api/audit` flow.

## Install

```bash
cd mcp
npm install
```

## Configure

Point `REDIRECT_SENTINEL_URL` at **your** deployed site.

### Claude Code

```bash
claude mcp add redirect-sentinel \
  --env REDIRECT_SENTINEL_URL=https://your-site.netlify.app \
  -- node /absolute/path/to/redirect-sentinel/mcp/index.mjs
```

…or commit a project-scoped `.mcp.json` (see below).

### Claude Desktop

Edit `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`,
Windows: `%APPDATA%\Claude\`) and add:

```json
{
  "mcpServers": {
    "redirect-sentinel": {
      "command": "node",
      "args": ["/absolute/path/to/redirect-sentinel/mcp/index.mjs"],
      "env": { "REDIRECT_SENTINEL_URL": "https://your-site.netlify.app" }
    }
  }
}
```

Restart the client. Then ask, e.g.:

> Use check_redirects to confirm `https://www.example.com/old` redirects to
> `https://www.example.com/new`.

## Develop

```bash
npm test   # logic tests (chunking, formatting, errors) — no network needed
```
