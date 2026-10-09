# Test Brief

Parent: [`../PROJECT_BRIEF.md`](../PROJECT_BRIEF.md).

Tests use fake transport/storage or SDK in-memory/stdin/stdout connections.
They never require a Hamtrax production account.

| Area | Files and responsibility |
|------|--------------------------|
| `auth/` | `store.test.ts` — environment/keychain/config precedence and persistence |
| `commands/` | `whoami.test.ts`, `folders.test.ts`, `contacts.test.ts`, `activations.test.ts` — terminal API dispatch and output |
| `util/` | `http.test.ts`, `errors.test.ts`, `output.test.ts` — transport envelope, exit mapping, presentation |
| `mcp/` | `server.test.ts`, `stdio.test.ts` — protocol tool discovery, scopes, mutation confirmations, idempotency, privacy, and clean stdout |
