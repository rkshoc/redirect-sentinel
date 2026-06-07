#!/usr/bin/env node
// Redirect Sentinel MCP server (stdio). Exposes the deployed /api/check endpoint
// as a tool so Claude Desktop / Claude Code can audit HTTP redirects directly.
//
// Config (point at YOUR deployed site):
//   {
//     "mcpServers": {
//       "redirect-sentinel": {
//         "command": "node",
//         "args": ["/abs/path/redirect-sentinel/mcp/index.mjs"],
//         "env": { "REDIRECT_SENTINEL_URL": "https://your-site.netlify.app" }
//       }
//     }
//   }

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { runCheck, formatText, MAX_TOTAL } from './lib.mjs';

const BASE = process.env.REDIRECT_SENTINEL_URL;

const CHECK_TOOL = {
  name: 'check_redirects',
  description:
    'Audit HTTP redirects against an AEM + Akamai setup. Traces each source URL ' +
    'hop-by-hop (status, server/edge tag, timing) and, when an expected target is ' +
    'given, returns a STRICT pass/fail contract verdict (PASS / FAIL / BLOCKED). ' +
    `Handles up to ${MAX_TOTAL} URLs per call. Use "items" for source/expected ` +
    'contract checks, or "urls" to just trace chains.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Source/expected pairs for a strict contract check.',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', description: 'Source URL to trace.' },
            expected: { type: 'string', description: 'Expected final URL (strict exact match decides PASS/FAIL).' },
            ruleName: { type: 'string', description: 'Optional label carried into the result.' },
          },
          required: ['source'],
        },
      },
      urls: {
        type: 'array',
        description: 'Plain list of source URLs to trace (no expected-target comparison).',
        items: { type: 'string' },
      },
      baseUrl: { type: 'string', description: 'Optional base to resolve relative source/expected paths.' },
    },
  },
};

const server = new Server(
  { name: 'redirect-sentinel', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [CHECK_TOOL] }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'check_redirects') {
    return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }], isError: true };
  }
  const a = req.params.arguments || {};
  try {
    const out = await runCheck({ baseUrl: BASE, items: a.items, urls: a.urls, baseForRelative: a.baseUrl });
    const text = `${formatText(out)}\n\n\`\`\`json\n${JSON.stringify(out, null, 2)}\n\`\`\``;
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
// stdout is reserved for the MCP protocol — log to stderr.
console.error(`redirect-sentinel MCP server running (stdio). Target: ${BASE || '(REDIRECT_SENTINEL_URL not set)'}`);
