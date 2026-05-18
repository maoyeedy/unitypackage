import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/generated/**'] },

  // All TS/TSX: recommended rules
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },

  // Node env for non-browser packages
  {
    files: ['packages/**/*.ts', 'fixtures/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // CLI: type-aware rules (no-floating-promises, no-explicit-any)
  {
    files: ['packages/cli/**/*.ts'],
    ignores: ['packages/cli/**/*.test.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // Web app: browser globals (React plugin rules added in Step E)
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
);
