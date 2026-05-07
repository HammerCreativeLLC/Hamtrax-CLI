import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The Hamtrax-CLI package is published independently and ships no CSS;
  // disable PostCSS so vitest doesn't try to resolve a parent-monorepo
  // postcss.config.js that references tooling we don't depend on.
  css: { postcss: { plugins: [] } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts', 'src/types.ts'],
    },
  },
});
