# Changelog

All notable changes to `hamtrax` (the CLI and MCP server) are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-12

### Added
- `--limit` and `--cursor` on `activations list`, with one bounded page per call.

### Changed
- Pagination guidance preserves cursors on empty in-progress activation pages;
  continue with the same filters until the cursor is absent.
- MCP results include the same privacy-safe JSON in text and structured content
  for clients that consume text results. Tool annotations reuse existing titles.

## [0.2.1] - 2026-10-12

### Changed
- Tool descriptions state approval preconditions, parameter contracts, and side
  effects as facts. Initialization retains the shared model safety guidance.

## [0.2.0] - 2026-10-09

### Added
- `hamtrax-mcp` and `hamtrax mcp`, sharing CLI credentials and the existing API.
- Four read tools by default, opt-in contact/activation creation and confirmed
  deletion, required mutation identities, strict inputs, and privacy-safe results.
- One shared MCP factory and HTTP contract for ESM and CommonJS hosts.
- Optional `--idempotency-key` on terminal write commands.
- MCP protocol, permission, replay identity, redaction, and executable checks.

## [0.1.1] - 2026-05-07

### Fixed
- `package.json` `repository.url` and `bugs.url` now use the canonical
  GitHub case (`HammerCreativeLLC`) so npm provenance verification can match
  the URL emitted by GitHub Actions. The 0.1.0 publish was rejected by npm
  for this reason and never landed in the registry.

## [0.1.0] - 2026-05-07

### Added
- Initial release.
- `auth login`, `auth set-key`, `auth status`, `auth logout`, `auth panic-revoke`.
- `whoami`.
- `folders list`, `folders show`.
- `contacts list`, `contacts create`, `contacts delete`.
- `activations list`, `activations create`.
- `--json` and `--ndjson` output modes.
- `--help-json` machine-readable manifest and `help --all` for full help dump.
- Deterministic exit codes (0–8) per [README](./README.md#exit-codes).
- Keychain-first key storage with 0600 file fallback (`HAMTRAX_NO_KEYRING=1` to force file).
