# MCP Brief

Parent: [`../SRC_BRIEF.md`](../SRC_BRIEF.md).

| File | Purpose |
|------|---------|
| `server.ts` | The one validated tool registry and `createHamtraxMcpServer` factory exported as `hamtrax/mcp` |
| `results.ts` | Bounded privacy-safe result projections and sanitized protocol error results |
| `stdio.ts` | Credential resolution and stdio transport shared by both executable entry points |
| `cli.ts` | The `hamtrax-mcp` executable |

The factory accepts a `HamtraxMcpClient` with the existing HTTP `request`
contract. Hosted Hamtrax supplies an authenticated adapter through the same
contract. No tool may write Firestore or implement folder hygiene locally.

Default scope is `read`. `write` enables create tools; `delete` enables confirmed
deletion. The hosting authorization boundary must supply the caller's granted
scopes. Tool annotations describe behavior; they do not grant authority.
