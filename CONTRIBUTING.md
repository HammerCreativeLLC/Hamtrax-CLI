# Contributing to Hamtrax CLI

Thanks for considering a contribution! This package lives at https://github.com/hammercreativellc/Hamtrax-CLI and is published to npm as `hamtrax`.

## Development

```bash
npm install
npm run dev          # tsx watch on src/cli.ts
npm test             # fresh build, then vitest protocol/command suites
npm run lint         # tsc --noEmit
npm run build        # emit ESM dist/ and shared CommonJS dist-cjs/
```

The executables are ESM and target Node >= 20. Shared `hamtrax/mcp` and
`hamtrax/http` exports support both ESM and CommonJS.

## Project layout

Start at [PROJECT_BRIEF.md](PROJECT_BRIEF.md) and follow the owning source or
test brief. The MCP registry is shared by local and hosted entry points; the
HTTP API remains the owner of account, folder, and mutation policy.

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
4. Merge the reviewed change after CI passes, then push the matching `v<version>`
   tag. The `Release to npm` GitHub Actions workflow builds/tests and publishes
   with npm provenance using the repository's maintainer token.

## License

By contributing you agree your changes are licensed under the MIT License — see [LICENSE](./LICENSE).
