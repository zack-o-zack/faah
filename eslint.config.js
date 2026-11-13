import js from '@eslint/js';
import solid from 'eslint-plugin-solid';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
// typescript-eslint parses with the TypeScript 6 JS API from scripts/eslint-typescript; tsc itself is the native TypeScript 7.
import tseslint from 'eslint-typescript';

const frontend = ['web/src/**/*.{ts,tsx}'];
const typescript = ['web/src/**/*.{ts,tsx}', 'vite.config.ts'];
const tooling = [
  'vite.config.ts',
  'eslint.config.js',
  'scripts/build-web.js',
  'scripts/check-web.js',
  'scripts/eslint-typescript/index.js',
];
function asError(rule) {
  const config = Array.isArray(rule) ? rule : [rule];
  if (config[0] === 'off' || config[0] === 0) return rule;
  return ['error', ...config.slice(1)];
}
const solidRules = Object.fromEntries(
  Object.entries(solid.configs.recommended.rules).map(([name, rule]) => [name, asError(rule)]),
);

export default [
  { ignores: ['node_modules/**', 'web/dist/**'] },
  {
    files: [...frontend, ...tooling],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: globals.browser,
    },
  },
  {
    files: frontend,
    plugins: { solid },
    rules: {
      ...solidRules,
      'no-nested-ternary': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.name='createEffect'] > :matches(ArrowFunctionExpression, FunctionExpression)[async=true]",
          message: 'Use createResource or a cancellable store action for async work.',
        },
        {
          selector: "VariableDeclarator[id.type='ObjectPattern'][init.name='props']",
          message: 'Keep props reactive; use props.name, splitProps or mergeProps.',
        },
        {
          selector:
            "JSXExpressionContainer:not([parent.type='JSXAttribute']) > LogicalExpression[operator='&&']",
          message: 'Use Show for conditional rendering.',
        },
        {
          selector: "JSXExpressionContainer > CallExpression[callee.property.name='map']",
          message: 'Use For or Index for list rendering.',
        },
        // Markup is JSX. The few sites that show server or sanitized HTML disable this with a reason.
        {
          selector: "JSXAttribute[name.name='innerHTML']",
          message: 'Render JSX; only server-highlighted or sanitized HTML may use innerHTML.',
        },
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.name=/^(inner|outer)HTML$/], CallExpression[callee.property.name='insertAdjacentHTML']",
          message: 'Render JSX instead of writing HTML strings into the DOM.',
        },
      ],
      'max-statements-per-line': ['error', { max: 1 }],
    },
  },
  // Syntactic rules only: type-aware ones need the TypeScript JS API, which TypeScript 7 lacks until 7.1.
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: typescript })),
  {
    files: typescript,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
        },
      ],
      // tsc reports unused locals and parameters.
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  { files: tooling, languageOptions: { globals: globals.node } },
  {
    files: ['web/src/**/*.test.{ts,tsx}', 'web/src/test-setup.ts'],
    languageOptions: { globals: globals.vitest },
  },
  { ...prettier, files: [...frontend, ...tooling] },
];
