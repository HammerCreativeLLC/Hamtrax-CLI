import { chmodSync, writeFileSync } from 'node:fs';

for (const path of ['dist/cli.js', 'dist/mcp/cli.js']) chmodSync(path, 0o755);
writeFileSync('dist-cjs/package.json', JSON.stringify({ type: 'commonjs' }) + '\n');
