import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Cheerio callbacks are (_, element): the index is often unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Keeps type-only imports erased, which is what verbatimModuleSyntax wants.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'off',
    },
  },

  {
    // The package itself is all TypeScript; the only JavaScript left is tooling
    // like this file, which sits outside the tsconfig project and so cannot be
    // linted with the rules that need type information.
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  }
);
