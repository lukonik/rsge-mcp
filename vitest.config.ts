import { configDefaults, defineConfig } from 'vitest/config';

const runLiveTests = process.env.RSGE_LIVE_TESTS === '1';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: runLiveTests
      ? [...configDefaults.exclude]
      : [...configDefaults.exclude, 'tests/live/**'],
  },
});
