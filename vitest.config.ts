import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: { label: 'core', color: 'cyan' },
          root: './packages/core',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: {
          name: { label: 'cli', color: 'yellow' },
          root: './packages/cli',
          include: ['src/**/*.test.ts'],
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: { label: 'web', color: 'green' },
          root: './apps/web',
          include: ['src/**/*.test.ts'],
        },
      },
    ],
  },
});
