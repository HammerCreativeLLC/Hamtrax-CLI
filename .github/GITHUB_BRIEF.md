# GitHub Automation Brief

Parent: [`../PROJECT_BRIEF.md`](../PROJECT_BRIEF.md).

| Workflow | Purpose |
|----------|---------|
| `workflows/ci.yml` | Install, TypeScript checks, tests, and build on PRs and main |
| `workflows/release.yml` | Check and pack version tags for GitHub releases; explicitly dispatch npm publication from the same workflow |

Tag pushes (`v*.*.*`) run install, lint, tests, build, and `npm pack`, then attach
`dist/cli.js` and `hamtrax-*.tgz` to the GitHub release. They never publish to npm.

After supplying a valid `NPM_TOKEN` GitHub Actions secret, run
`gh workflow run release.yml --ref <v-version-tag> -f publish_npm=true` to dispatch
the same checks and publish with npm provenance. `publish_npm` defaults to false; branch
dispatches fail before checkout. Manual dispatch does not recreate the GitHub
release. The workflow must exist on the default branch for dispatch to be available.
Never put registry credentials in source, logs, package contents, or MCP configuration.
