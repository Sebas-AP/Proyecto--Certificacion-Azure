import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/api.integration.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
});