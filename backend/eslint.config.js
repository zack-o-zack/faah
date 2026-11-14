// Type-aware linting for the Bun backend. typescript-eslint gets the TypeScript 6 JS API from
// scripts/eslint-typescript; the backend's own typecheck stays on the native TypeScript 7 tsc.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'eslint-typescript';

const sources = ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts', 'bench/**/*.ts'];

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'spike/**', 'src/http/manifest.js', '**/*.bundle'],
  },
  { ...js.configs.recommended, files: sources },
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: sources })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({ ...config, files: sources })),
  prettier,
  {
    files: sources,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false, 'ts-expect-error': true },
      ],
      // tsc reports unused locals and parameters.
      '@typescript-eslint/no-unused-vars': 'off',
      // Numbers in messages and paths are ordinary; other values must be strings first.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/restrict-plus-operands': [
        'error',
        { allowNumberAndString: true, allowAny: false, allowBoolean: false, allowNullish: false },
      ],
      // Arrow no-ops are the idiomatic "ignore this callback".
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
      // Go treats empty strings and false as absent; `||` deliberately keeps that meaning.
      '@typescript-eslint/prefer-nullish-coalescing': [
        'error',
        { ignorePrimitives: { string: true, boolean: true } },
      ],
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: 'only-allowed-literals' },
      ],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: ['function', 'class', 'export'] },
        { blankLine: 'always', prev: ['function', 'class'], next: '*' },
      ],
      '@typescript-eslint/lines-between-class-members': 'off',
      'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
      'id-length': [
        'error',
        { min: 2, properties: 'never', exceptions: ['_', 'a', 'b', 'i', 'j', 'k', 'n'] },
      ],
    },
  },
  {
    // bun:test types `expect(...).resolves/rejects` as void, and async stubs satisfy
    // Promise-returning interfaces without awaiting.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
];
