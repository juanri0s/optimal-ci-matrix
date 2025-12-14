import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.config.ts',
        '**/*.config.js',
        '**/test/**',
        '**/*.test.ts',
      ],
      all: false,
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 98,
        statements: 100,
      },
    },
  },
});
