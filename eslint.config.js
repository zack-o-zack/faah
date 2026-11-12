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
  'web/src/calls.js',
  'web/src/cardkeep.js',
  'web/src/cardkeep.test.js',
  'web/src/commitfiles.js',
  'web/src/contrast.test.js',
  'web/src/controls.js',
  'web/src/controls.test.js',
  'web/src/cursor.js',
  'web/src/diff.js',
  'web/src/editview.js',
  'web/src/errors.js',
  'web/src/errors.test.js',
  'web/src/find.js',
  'web/src/forgeconnect.js',
  'web/src/gitpanel.js',
  'web/src/gitstream.js',
  'web/src/history.js',
  'web/src/hover-position.js',
  'web/src/hover-position.test.js',
  'web/src/hover.js',
  'web/src/imageview.js',
  'web/src/inspector.js',
  'web/src/linecomment.js',
  'web/src/lsp.js',
  'web/src/lspsetup.js',
  'web/src/main.js',
  'web/src/markdown-picture.js',
  'web/src/markdown-picture.test.js',
  'web/src/markdown.js',
  'web/src/mermaid.js',
  'web/src/metricsview.js',
  'web/src/newitem.js',
  'web/src/orb.js',
  'web/src/orb.test.js',
  'web/src/outline.js',
  'web/src/overlays.js',
  'web/src/overlays.test.js',
  'web/src/palette.js',
  'web/src/palette.test.js',
  'web/src/panels.js',
  'web/src/pr.js',
  'web/src/prmerge.js',
  'web/src/prscope.js',
  'web/src/renderer.js',
  'web/src/reviewflow.js',
  'web/src/reviewflow.test.js',
  'web/src/reviewwalkthrough.js',
  'web/src/search.js',
  'web/src/selbar.js',
  'web/src/settings.js',
  'web/src/shortcuts.js',
  'web/src/state.js',
  'web/src/status.js',
  'web/src/stream.js',
  'web/src/table.js',
  'web/src/tabs.js',
  'web/src/theme.test.js',
  'web/src/thread.js',
  'web/src/threadrefs.js',
  'web/src/threadrefs.test.js',
  'web/src/tips-util.js',
  'web/src/tips.js',
  'web/src/tips.test.js',
  'web/src/toast.test.js',
  'web/src/tree.js',
  'web/src/typescale.test.js',
  'web/src/ui.js',
  'web/src/unpushed.js',
  'web/src/vim.js',
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
