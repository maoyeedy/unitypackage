import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  ignoreBinaries: ['printf'],
  ignoreUnresolved: ['./src/test/setup.ts'],
  workspaces: {
    '.': {
      entry: ['scripts/*.ts'],
    },
    'apps/web': {
      entry: ['src/**/*.test.{ts,tsx}'],
      project: ['src/**/*.{ts,tsx}'],
      ignoreDependencies: ['@fontsource-variable/inter'],
    },
  },
};

export default config;
