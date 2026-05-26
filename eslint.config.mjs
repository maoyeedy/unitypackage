import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dev-dist/**', '**/node_modules/**', '**/generated/**'] },

  // Base: non-type-aware rules for all TS/TSX files
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
    },
  },

  // Type-aware upgrade: source files that have tsconfig coverage
  {
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

  // Node env for non-browser packages
  {
    files: ['packages/**/*.ts', 'fixtures/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Web app: browser globals + React rules
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...reactRefresh.configs.vite.rules,
    },
  },
);
