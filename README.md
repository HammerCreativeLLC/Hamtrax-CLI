# Hamtrax CLI

`hamtrax` is the official command-line client for [Hamtrax](https://hamtrax.com) — log POTA contacts, manage activations, and inspect your station's data straight from your terminal or an AI agent.

The CLI is a thin wrapper over Hamtrax's HTTP API (`/v1/*`). Every command is non-interactive when given enough flags, returns JSON via `--json`/`--ndjson`, and uses deterministic exit codes — so it's safe to drive from shell scripts, CI, or LLM agent loops.

---

## Installation

```bash
npm install -g hamtrax
```

Requires Node.js >= 20.

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
