import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          root: './packages/core',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'cli',
          root: './packages/cli',
          include: ['src/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'web',
          root: './apps/web',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
