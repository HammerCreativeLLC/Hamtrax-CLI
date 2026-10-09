# Authentication Brief

Parent: [`../SRC_BRIEF.md`](../SRC_BRIEF.md).

| File | Purpose |
|------|---------|
| `store.ts` | One credential owner: environment, OS keychain, or protected config file |
| `login.ts` | Interactive key entry and `/v1/whoami` validation |
| `setKey.ts` | Noninteractive credential entry |
| `status.ts` | Credential source plus authenticated identity |
| `logout.ts` | Local credential removal |
| `panicRevoke.ts` | Explain account-owned server revocation |

MCP reads through `store.ts`; credentials are never tool arguments or results.
