import { expect, test } from 'vitest';
import { foldToolSteps, parseToolStep } from './steps.ts';
import { mockupSteps } from './test-steps.ts';

const paths = { root: '/home/me/repo', home: '/home/me' };
const fold = (labels: string[]) =>
  foldToolSteps(labels.map((label) => parseToolStep(label, paths)));

test('paths show their basename and workspace-relative folder before shortening the home', () => {
  const label = 'Read /home/me/repo/internal/git/probe.go';
  expect(parseToolStep(label, paths)).toMatchObject({
    label,
    tool: 'Read',
    target: '/home/me/repo/internal/git/probe.go',
    basename: 'probe.go',
    folder: 'internal/git/',
    path: true,
  });
  expect(parseToolStep('Read /home/me/repo/file.go', paths)).toMatchObject({
    basename: 'file.go',
    folder: '',
  });
  expect(parseToolStep('Read internal/git/probe.go', paths)).toMatchObject({
    basename: 'probe.go',
    folder: 'internal/git/',
    path: true,
  });
  expect(parseToolStep('Read /home/me/repo/file.go', { root: paths.root + '/' }).folder).toBe('');
  expect(parseToolStep('Read /file.go', { root: '/' }).folder).toBe('');
});

test('home paths use ~, respect directory boundaries, and remain absolute without metadata', () => {
  expect(parseToolStep('Write /home/me/notes/MEMORY.md', paths)).toMatchObject({
    basename: 'MEMORY.md',
    folder: '~/notes/',
  });
  expect(parseToolStep('Read ~/.config/memory.md', paths).folder).toBe('~/.config/');
  expect(parseToolStep('Read /home/me/repo-other/file.go', paths).folder).toBe('~/repo-other/');
  expect(parseToolStep('Read /home/me-other/file.go', paths).folder).toBe('/home/me-other/');
  expect(parseToolStep('Read /home/me/notes/MEMORY.md').folder).toBe('/home/me/notes/');
});

test.each([
  ['Bash go test ./internal/git/...', 'Bash', 'go test ./internal/git/...'],
  ['Grep Probe(', 'Grep', 'Probe('],
  ['Grep src/**/*.tsx', 'Grep', 'src/**/*.tsx'],
  ['Read /a folder/file.go', 'Read', '/a folder/file.go'],
  ['  Bash   npm run check  ', 'Bash', 'npm run check'],
])('parser separates %s without splitting commands into paths', (label, tool, target) => {
  const step = parseToolStep(label);
  expect(step.tool).toBe(tool);
  expect(step.target).toBe(target);
  expect(step.path).toBe(!/\s/.test(target) && target.includes('/'));
  expect(step.label).toBe(label);
});

test.each([
  ['Read', 'file-text'],
  ['Edit', 'pencil-simple'],
  ['MultiEdit', 'pencil-simple'],
  ['NotebookEdit', 'pencil-simple'],
  ['Write', 'file-plus'],
  ['Bash', 'terminal'],
  ['Grep', 'magnifying-glass'],
  ['Glob', 'magnifying-glass'],
  ['WebFetch', 'globe'],
  ['WebSearch', 'globe'],
  ['CustomTool', 'wrench'],
  ['toString', 'wrench'],
])('%s uses its tool icon', (tool, icon) => {
  expect(parseToolStep(`${tool} target`).icon).toBe(`icon-[ph--${icon}]`);
});

test.each(['Show notes', 'Show a walkthrough'])(
  '%s keeps the whole label and special icon',
  (label) => {
    expect(parseToolStep(label)).toMatchObject({
      tool: label,
      special: true,
      icon: 'icon-[ph--spinner]',
      target: '',
      path: false,
    });
  },
);

test('unknown tools and calls without arguments retain the verb', () => {
  expect(parseToolStep('CustomTool')).toMatchObject({
    tool: 'CustomTool',
    target: '',
    basename: '',
    icon: 'icon-[ph--wrench]',
  });
  expect(parseToolStep('')).toMatchObject({ tool: '', target: '', path: false });
});

test('the approved 24-step sequence folds to the A3 rows', () => {
  const rows = fold(mockupSteps);
  expect(mockupSteps).toHaveLength(24);
  expect(rows.map((row) => [row.step.tool, row.target, row.steps.length])).toEqual([
    ['Read', '3 files', 3],
    ['Grep', 'gitCache', 1],
    ['Read', '3 files', 3],
    ['Grep', 'Probe(', 1],
    ['Edit', 'probe.go', 2],
    ['Bash', 'go test ./internal/git/...', 1],
    ['Edit', 'git.go', 1],
    ['Bash', 'go test ./internal/git/...', 1],
    ['Read', 'probe_test.go', 1],
    ['Edit', 'probe_test.go', 1],
    ['Bash', 'go test ./...', 1],
    ['Read', 'git-integration.md', 1],
    ['Edit', 'git-integration.md', 1],
    ['Write', 'explain-closest-language-only.md', 1],
    ['Read', 'MEMORY.md', 1],
    ['Edit', 'MEMORY.md', 1],
    ['Bash', 'npm run check', 1],
    ['Grep', 'TODO', 1],
    ['Bash', 'git status --short', 1],
  ]);
  expect(rows[0]).toMatchObject({ kind: 'group', folder: 'probe.go, git.go, status.go' });
  expect(rows[2]).toMatchObject({ kind: 'group', folder: 'git.go, store.ts, GitPanel.tsx' });
  expect(rows[4]?.kind).toBe('repeat');
  expect(rows.flatMap((row) => row.steps.map((step) => step.label))).toEqual(mockupSteps);
});

test('folds only consecutive tools and compares complete targets rather than basenames', () => {
  expect(fold([])).toEqual([]);
  const rows = fold(['Read one/a.go', 'Read two/a.go', 'Grep foo', 'Read one/a.go']);
  expect(rows.map((row) => row.kind)).toEqual(['group', 'single', 'single']);
  expect(rows[0]?.folder).toBe('a.go, a.go');
  expect(fold(['Bash npm test', 'Bash npm test'])[0]).toMatchObject({
    kind: 'repeat',
    target: 'npm test',
  });
  expect(fold(['Bash npm test', 'Bash npm run check'])[0]).toMatchObject({
    kind: 'group',
    target: '2 items',
    folder: 'npm test, npm run check',
  });
  expect(fold(['Show notes', 'Show a walkthrough']).map((row) => row.kind)).toEqual([
    'single',
    'single',
  ]);
});
