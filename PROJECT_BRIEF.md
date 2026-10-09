# Hamtrax CLI Project Brief

The official `hamtrax` npm package contains the terminal client and its MCP
adapter. Both call Hamtrax's existing `/v1/` API; account authority and logbook
mutations remain in the Hamtrax application's Cloud Functions project.

Start here, then follow the owning brief before searching.

| Area | Brief | Purpose |
|------|-------|---------|
| Source | [`src/SRC_BRIEF.md`](src/SRC_BRIEF.md) | Command registration, credentials, HTTP client, and shared MCP tools |
| Tests | [`test/TEST_BRIEF.md`](test/TEST_BRIEF.md) | Isolated Node and MCP protocol coverage; no production account access |
| Build helpers | [`scripts/SCRIPTS_BRIEF.md`](scripts/SCRIPTS_BRIEF.md) | Generated package output finalization |
| GitHub automation | [`.github/GITHUB_BRIEF.md`](.github/GITHUB_BRIEF.md) | CI and tagged npm releases |

| Root file | Purpose |
|-----------|---------|
| `README.md` | Published user setup, commands, and MCP connection guide |
| `CHANGELOG.md` | Published release changes |
| `CONTRIBUTING.md` | Contributor setup and checks |
| `package.json`, `package-lock.json` | Version, dependencies, executable/library exports, npm release contents |
| `tsconfig.json` | NodeNext library and executable build |
| `tsconfig.cjs.json` | CommonJS build of the same shared MCP/HTTP sources for Firebase Functions |
| `vitest.config.ts` | Isolated test configuration |
| `LICENSE` | MIT license |

Generated `dist/`, `dist-cjs/`, `node_modules/`, and `coverage/` are not source owners.
