import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  workspaces: {
    '.': {
      entry: ['scripts/*.ts'],
    },
    'apps/web': {
      entry: ['src/**/*.test.ts'],
      project: ['src/**/*.{ts,tsx}'],
    },
  },
};

export default config;
