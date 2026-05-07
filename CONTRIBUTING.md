# Contributing to Hamtrax CLI

Thanks for considering a contribution! This package lives at https://github.com/hammercreativellc/Hamtrax-CLI and is published to npm as `hamtrax`.

## Development

```bash
npm install
npm run dev          # tsx watch on src/cli.ts
npm test             # vitest run
npm run lint         # tsc --noEmit
npm run build        # emit dist/
```

The package is **ESM** (`"type": "module"` in `package.json`) and targets Node >= 20.

## Project layout

```
src/
  cli.ts          # entry point; wires Commander, dispatches to handlers
  auth/           # login, set-key, status, logout, panic-revoke + storage
  commands/       # whoami / folders / contacts / activations registrations
  util/
    http.ts       # fetch wrapper, ApiError / NetworkError
    errors.ts     # exit-code mapping, formatErrorForStderr
    output.ts     # printJson / printNdjson / printTable / printKeyValue
  types.ts        # wire types — single source of truth for the API contract
  version.ts      # CLI_VERSION (from package.json) and API_VERSION
test/
  auth/ commands/ util/   # vitest suites; mock fetch / fs / keytar / prompts
```

## Pull-request checklist

- [ ] `npm run lint` passes (`tsc --noEmit`).
- [ ] `npm test` passes; new behavior has new tests.
- [ ] If you add a command, it has ≥2 examples in its help text.
- [ ] If you add an option, it appears in `--help-json`.
- [ ] No plaintext API keys in logs, errors, or test fixtures.
- [ ] CHANGELOG entry under `[Unreleased]`.

## Output and error contract

- Data → stdout. Warnings/errors → stderr.
- `--json` is a single object; `--ndjson` is line-delimited (list commands only).
- Errors follow `formatErrorForStderr` (plan §4e):
  - Plain: `hamtrax: <command>: <error_code>: <message>`
  - JSON: `{"command","error","message","exitCode",...}`
- Exit codes are deterministic — see [README](./README.md#exit-codes).

## Releasing

1. Update `CHANGELOG.md` (move `[Unreleased]` to a new dated section).
2. Bump `package.json` version.
3. `npm run lint && npm test && npm run build`.
4. `npm publish` (maintainers only).

## License

By contributing you agree your changes are licensed under the MIT License — see [LICENSE](./LICENSE).
