# Hamtrax CLI

`hamtrax` is the official command-line client and MCP server for [Hamtrax](https://hamtrax.com) — log POTA contacts, manage activations, and inspect your station's data straight from your terminal or an AI assistant.

The CLI is a thin wrapper over Hamtrax's HTTP API (`/v1/*`). Every command is non-interactive when given enough flags, returns JSON via `--json`/`--ndjson`, and uses deterministic exit codes — so it's safe to drive from shell scripts, CI, or LLM agent loops.

---

## Installation

MCP support requires Hamtrax 0.2.0. npm publication of 0.2.0 is pending;
the registry's current `latest` is 0.1.1, which includes the CLI without MCP.
Install the official [GitHub release](https://github.com/HammerCreativeLLC/Hamtrax-CLI/releases/tag/v0.2.0):

```bash
npm install -g https://github.com/HammerCreativeLLC/Hamtrax-CLI/releases/download/v0.2.0/hamtrax-0.2.0.tgz
```

Requires Node.js >= 20.

---

## MCP for AI assistants

Install the 0.2.0 release above, authenticate once with `hamtrax auth login`,
then add this local stdio server to your MCP client's configuration:

```json
{
  "mcpServers": {
    "hamtrax": {
      "command": "hamtrax-mcp"
    }
  }
}
```

`hamtrax mcp` runs the same server. It reuses your CLI credential storage and
endpoint configuration. API keys are never entered into tool arguments or
returned to the assistant. Standard output contains only MCP messages.

The default exposes four read tools: `whoami`, `list_folders`, `list_contacts`,
and `list_activations`. Each list call returns one page (50 rows by default,
maximum 200); use its cursor to request the next page. Results contain logbook
summaries and contact details, excluding private account IDs, credential fields,
and precise coordinates.

To allow creation, add `"args": ["--allow-writes"]` to the server configuration.
This enables `create_contact` and `create_activation`. To also allow deletion,
use `"args": ["--allow-writes", "--allow-deletes"]` with an elevated API key.
The server's local options and the API key's permissions both apply.

Every write tool requires an `idempotency_key`; use a unique UUID and reuse it
with identical arguments after a timeout. Contact creation requires an explicit
`time_on`, and activation creation requires `start_time`, so retries keep the same
UTC day. Deletion requires the exact confirmation `DELETE <qso_id>` after user
approval.

Creating an activation finds or creates its same-day folder and can reopen an
existing activation. It sends no POTA spot. Saving a contact may also sync it to
an enabled QRZ connection; deleting through Hamtrax does not delete the QRZ
counterpart. Confirm the intended operation with the user before invoking a
write tool. Folder ownership, matching park/month, free-tier caps, and rate limits
are enforced by Hamtrax's existing API.

### Hosted integrations

The same `createHamtraxMcpServer` registry is exported as `hamtrax/mcp` for
Hamtrax's OAuth-protected remote service. Its host provides the authenticated
`request` adapter and granted `read`, `write`, or `delete` scopes. Both ESM and
CommonJS consumers are supported. `hamtrax/http` exports the shared `HttpClient`,
`RequestOptions`, and `ApiError` contract; no hosted adapter needs a copy of the
tool definitions or logbook rules.

```ts
import { createHamtraxMcpServer } from 'hamtrax/mcp';
import { HttpClient } from 'hamtrax/http';

const server = createHamtraxMcpServer({
  version: 'your-deployment-version',
  scopes: ['read'],
  authentication: 'apiKey',
  client: new HttpClient({ apiBase: yourApiBase, apiKey: yourStoredKey }),
});
// Connect server to the standard MCP transport supplied by your host.
```

---

## Quick start

```bash
# 1. Get an API key from https://hamtrax.com/cli/security
# 2. Save it locally (keychain when available, 0600 file otherwise)
hamtrax auth login

# 3. Confirm it works
hamtrax whoami

# 4. Start a POTA activation
hamtrax activations create --reference K-1234 --callsign K1ABC

# 5. Log a QSO into the new folder
hamtrax contacts create \
  --folder <id-from-step-4> \
  --callsign K2XYZ \
  --frequency 14.074 \
  --mode FT8
```

---

## Auth

```bash
hamtrax auth login            # Interactive prompt, validates via /v1/whoami
hamtrax auth set-key <key>    # Non-interactive (also accepts stdin)
hamtrax auth status           # Where is my key stored? Plus /v1/whoami
hamtrax auth logout           # Remove key from this machine
hamtrax auth panic-revoke     # Explains how to revoke server-side
```

### Where the key lives

Resolved in this order:

1. `HAMTRAX_API_KEY` env var (highest priority — handy for CI)
2. OS keychain via `keytar`
3. `~/.config/hamtrax/config.json` (mode 0600)

Set `HAMTRAX_NO_KEYRING=1` to force the file backend.

`auth panic-revoke` prints instructions only — true server-side revocation requires Firebase Auth (web sign-in) and is not yet exposed via the CLI. See https://hamtrax.com/cli/security.

---

## Commands

Every command supports `--json` (single object). List commands also support `--ndjson` (one JSON object per line). Run `hamtrax help --all` for everything in one shot, or `hamtrax --help-json` for a machine-readable manifest your agent can parse.

| Command                                 | Description |
|-----------------------------------------|-------------|
| `hamtrax whoami`                        | Show the identity associated with the active key. |
| `hamtrax folders list [--type ...]`     | List logging folders. |
| `hamtrax folders show <id>`             | Inspect one folder. |
| `hamtrax contacts list --folder <id>`   | Page through QSOs in a folder. |
| `hamtrax contacts create ...`           | Log a new QSO. |
| `hamtrax contacts delete <qsoId> --yes` | Delete a QSO. |
| `hamtrax activations list [--in-progress]` | List activations. |
| `hamtrax activations create --reference K-1234 --callsign K1ABC` | Start (or upsert) a POTA activation. |
| `hamtrax mcp [--allow-writes] [--allow-deletes]` | Serve the local MCP tools over stdio. |

Contact creation, deletion, and activation creation also accept
`--idempotency-key <unique-operation-id>` for safe retries through the same HTTP
header used by MCP. Supply the same timestamp and fields on a retry.

---

## Output formats

- **Default (TTY):** colorized tables / key-value pairs.
- **`--json`:** single JSON object on stdout. Errors go to stderr in the JSON form when this flag is set.
- **`--ndjson`:** newline-delimited JSON on stdout. List commands only.

Non-TTY stdout disables color automatically. `--no-color` forces it off.

---

## Exit codes

Stable across versions; agents can branch on these without parsing messages.

| Code | Meaning |
|-----:|---------|
| 0 | OK |
| 1 | Generic error |
| 2 | Invalid usage / argument |
| 3 | Auth (missing / expired / revoked) |
| 4 | Rate-limited (`Retry-After` echoed in error message) |
| 5 | Tier insufficient |
| 6 | QSO cap reached |
| 7 | Network / transport |
| 8 | Server (5xx) |

---

## Environment variables

| Variable             | Purpose |
|----------------------|---------|
| `HAMTRAX_API_KEY`    | Bearer token; overrides every storage backend. |
| `HAMTRAX_API_BASE`   | Override base URL (also `--api-base`). |
| `HAMTRAX_NO_KEYRING` | Set to `1` to force file storage. |

---

## Versioning

`hamtrax --version` prints the CLI version. The CLI version is independent of the API version; the API contract is `v1`. `--help-json` emits both as `cli_version` and `api_version`.

---

## License

MIT — see [LICENSE](./LICENSE).
