# Changelog

All notable changes to `hamtrax` (the CLI) are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
