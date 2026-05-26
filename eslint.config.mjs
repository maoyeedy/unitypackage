import js from '@eslint/js';
import { defineConfig, globalIgnores, includeIgnoreFile } from 'eslint/config';
import { fileURLToPath } from 'node:url';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { reactRefresh } from 'eslint-plugin-react-refresh';

const gitignorePath = fileURLToPath(new URL('.gitignore', import.meta.url));

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  globalIgnores(['**/dev-dist/**', '**/generated/**']),

  {
    name: 'base-ts-rules',
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
    },
  },

  {
    name: 'typed-linting',
    files: [
      'apps/web/src/**/*.{ts,tsx}',
      'apps/web/vite.config.ts',
      'packages/**/*.ts',
      'fixtures/**/*.ts',
    ],
    ignores: ['**/*.test.ts', '**/*.spec.ts'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },

  {
    name: 'node-env',
    files: ['packages/**/*.ts', 'fixtures/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    ...reactRefresh.configs.vite(),
    name: 'web-app',
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
    },
  },
);
