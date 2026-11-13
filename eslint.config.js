import js from '@eslint/js';
import solid from 'eslint-plugin-solid';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// Legacy modules leave this list as they are migrated.
const legacy = [
  'web/src/agent-picker.js',
  'web/src/agent-picker.test.js',
  'web/src/agent.js',
  'web/src/bus.js',
  'web/src/cardkeep.js',
  'web/src/cardkeep.test.js',
  'web/src/contrast.test.js',
  'web/src/controls.js',
  'web/src/controls.test.js',
  'web/src/errors.js',
  'web/src/errors.test.js',
  'web/src/forgeconnect.js',
  'web/src/linecomment.js',
  'web/src/main.js',
  'web/src/overlays.js',
  'web/src/overlays.test.js',
  'web/src/pr.js',
  'web/src/prmerge.js',
  'web/src/reviewflow.js',
  'web/src/reviewflow.test.js',
  'web/src/reviewwalkthrough.js',
  'web/src/settings.js',
  'web/src/shortcuts.js',
  'web/src/state.js',
  'web/src/theme.test.js',
  'web/src/thread.js',
  'web/src/threadrefs.js',
  'web/src/threadrefs.test.js',
  'web/src/tips-util.js',
  'web/src/tips.js',
  'web/src/tips.test.js',
  'web/src/toast.test.js',
  'web/src/typescale.test.js',
  'web/src/ui.js',
];
const frontend = ['web/src/**/*.{js,jsx}'];
const tooling = [
  'vite.config.js',
  'eslint.config.js',
  'scripts/build-web.js',
  'scripts/check-web.js',
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
  { ignores: [...legacy, 'node_modules/**', 'web/dist/**'] },
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
      ],
      'max-statements-per-line': ['error', { max: 1 }],
    },
  },
  { files: tooling, languageOptions: { globals: globals.node } },
  {
    files: ['web/src/**/*.test.{js,jsx}', 'web/src/test-setup.js'],
    languageOptions: { globals: globals.vitest },
  },
  { ...prettier, files: [...frontend, ...tooling] },
];
