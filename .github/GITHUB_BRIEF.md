# GitHub Automation Brief

Parent: [`../PROJECT_BRIEF.md`](../PROJECT_BRIEF.md).

| Workflow | Purpose |
|----------|---------|
| `workflows/ci.yml` | Install, TypeScript checks, tests, and build on PRs and main |
| `workflows/release.yml` | Run checks and publish `hamtrax` with npm provenance on `v*` tags |

The release workflow reads `NPM_TOKEN` from GitHub Actions secrets. Never put
registry credentials in source, logs, package contents, or MCP configuration.
