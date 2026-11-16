import documentBody from './fixtures/overview.md?raw';
import documentHTML from './fixtures/overview.html?raw';
import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { createEditorStore, type EditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { prMeta } from '../pr/test-editor.ts';
import { required } from '../lib/test-values.ts';
import { ReviewView } from './ReviewView.tsx';

const overview = {
  description: {
    body: '## Why this change',
    bodyHtml:
      '<h2>Why this change</h2><p><strong>Safe Markdown</strong></p><script>window.bad = true</script><img src="/avatar.png" onerror="alert(1)">',
  },
  checks: [
    { name: 'Tests', state: 'passed', url: 'https://ci.test/tests' },
    { name: 'Lint', state: 'failed', url: 'javascript:alert(1)' },
    { name: 'Build', state: 'running' },
    { name: 'Optional', state: 'skipped' },
    { name: 'Info', state: 'neutral' },
  ],
  reviewers: [
    { id: 'ana', name: 'Ana', avatarUrl: 'https://avatar.test/ana', state: 'approved' },
    { id: 'bo', name: 'Bo', state: 'changes_requested' },
    { id: 'cy', name: 'Cy', state: 'commented' },
    { id: 'dee', name: 'Dee', state: 'pending' },
  ],
};
function mount(data: unknown = overview, failing = false) {
  let editor: EditorStore | undefined;
  let fail = failing;
  const request = vi.fn(async (path: string) => {
    if (path.startsWith('api/pr/overview')) {
      if (fail) throw new Error('Forge unavailable');
      return data;
    }
    if (path.includes('walkthrough')) return { files: [], totalFiles: 0 };
    return { config: { stages: [] } };
  });
  render(() => {
    const app = createAppStore();
    app.actions.setWorkspace({ git: true, pr: prMeta() });
    app.actions.subscribeWorkspaceEvent = () => () => {};
    app.actions.setWorkspaceTopic = vi.fn();
    app.actions.watchWorkspaceThread = () => () => {};
    editor = createEditorStore(app, { review: { request } });
    return (
      <EditorProvider value={editor}>
        <ReviewView />
      </EditorProvider>
    );
  });
  return {
    editor: required(editor),
    request,
    recover: () => {
      fail = false;
    },
  };
}
const overviewCalls = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter(([path]) => path.startsWith('api/pr/overview'));

test('Overview is first and default, and renders sanitized description, checks and latest reviewer states', async () => {
  const { editor } = mount();
  editor.actions.setReviewMode('review');
  expect(
    screen
      .getAllByRole('tab')
      .map((tab) => tab.querySelector('[data-tab-label]')?.textContent?.trim()),
  ).toEqual(['Overview', 'Changed files', 'Review pipeline']);
  expect(screen.getByRole('tab', { name: /^Overview/ }).getAttribute('aria-selected')).toBe('true');
  await screen.findByRole('heading', { name: 'Why this change' });
  expect(document.querySelector('#pr-overview script')).toBeNull();
  expect(document.querySelector('#pr-overview [onerror]')).toBeNull();
  expect(screen.getByText('Safe Markdown').tagName).toBe('STRONG');
  expect(screen.getByLabelText('1 failed, 1 running, 1 passed, 1 neutral, 1 skipped')).toBeTruthy();
  expect(screen.getByText('1 approved, 1 requested changes, 1 commented, 1 awaiting')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '1 passed check' }));
  expect(screen.getByRole('link', { name: /Tests/ }).getAttribute('href')).toBe(
    'https://ci.test/tests',
  );
  expect(document.querySelector('#pr-overview a[href^="javascript:"]')).toBeNull();
  expect(screen.getByAltText('Ana').getAttribute('src')).toBe('https://avatar.test/ana');
  for (const state of ['Approved', 'Changes requested', 'Commented', 'Awaiting review'])
    expect(screen.getByText(state)).toBeTruthy();
});

test('Overview shows muted empty states', async () => {
  const { editor } = mount({
    description: { body: ' \n ', bodyHtml: '' },
    checks: [],
    reviewers: [],
  });
  editor.actions.setReviewMode('review');
  await screen.findByText('No description');
  expect(within(screen.getByRole('tabpanel')).getByText('No checks')).toBeTruthy();
  expect(screen.getByText('No reviewers')).toBeTruthy();
});

test('Overview errors stay in the tab, support retry and leave the other tabs usable', async () => {
  const { editor, recover } = mount(overview, true);
  editor.actions.setReviewMode('review');
  const alert = await screen.findByRole('alert');
  expect(alert.classList.contains('alert')).toBe(true);
  expect(alert.textContent).toContain('Forge unavailable');
  fireEvent.click(screen.getByRole('tab', { name: /Changed files/ }));
  await screen.findByText('No changes in this pull request');
  fireEvent.click(screen.getByRole('tab', { name: /Review pipeline/ }));
  expect(document.getElementById('review-stages-view')).not.toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: /^Overview/ }));
  await screen.findByRole('alert');
  recover();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('heading', { name: 'Why this change' });
  expect(screen.queryByRole('alert')).toBeNull();
});

test('Overview fetches only while visible, once per opening or refresh, and is default on reopening Review', async () => {
  const { editor, request } = mount();
  expect(overviewCalls(request)).toHaveLength(0);
  editor.actions.setReviewMode('review');
  await screen.findByRole('heading', { name: 'Why this change' });
  expect(overviewCalls(request)).toHaveLength(1);
  expect(request.mock.calls.some(([path]) => path.includes('walkthrough'))).toBe(false);
  fireEvent.click(screen.getByRole('tab', { name: /^Overview/ }));
  expect(overviewCalls(request)).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: /Changed files/ }));
  await screen.findByText('No changes in this pull request');
  fireEvent.click(screen.getByRole('tab', { name: /Review pipeline/ }));
  expect(overviewCalls(request)).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', { name: /^Overview/ }));
  await waitFor(() => expect(overviewCalls(request)).toHaveLength(2));
  await waitFor(() =>
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Refresh review' }).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }));
  await waitFor(() => expect(overviewCalls(request)).toHaveLength(3));
  fireEvent.click(screen.getByRole('tab', { name: /Review pipeline/ }));
  editor.actions.setReviewMode('code');
  editor.actions.setReviewMode('review');
  await waitFor(() => expect(overviewCalls(request)).toHaveLength(4));
  expect(screen.getByRole('tab', { name: /^Overview/ }).getAttribute('aria-selected')).toBe('true');
});

const documentOverview = {
  ...overview,
  description: {
    body: documentBody,
    bodyHtml: documentHTML,
    author: 'Zack',
    avatarUrl: 'https://avatar.test/zack',
    createdAt: '2026-01-01T10:00:00Z',
  },
};

test('design: status comes before the document in reading order, with no heavy cards', async () => {
  const { editor } = mount(documentOverview);
  editor.actions.setReviewMode('review');
  await screen.findByRole('heading', { name: 'Review the change, not the noise' });
  const sidebar = screen.getByRole('complementary', { name: 'PR status' });
  const body = screen.getByRole('article', { name: 'PR description' });
  expect(sidebar.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(
    within(sidebar)
      .getAllByRole('heading')
      .map((h) => h.textContent),
  ).toEqual(['Checks5', 'Reviewers']);
  expect(document.querySelector('#pr-overview .card')).toBeNull();
  expect(screen.getByText('Zack')).toBeTruthy();
  expect(document.querySelector('#pr-overview time')?.getAttribute('datetime')).toBe(
    '2026-01-01T10:00:00Z',
  );
});

test('design: checks and reviewers are ordered by importance without per-row badge pills', async () => {
  const { editor } = mount();
  editor.actions.setReviewMode('review');
  await screen.findByRole('heading', { name: 'Why this change' });
  const checks = screen.getByRole('list', { name: 'Checks' });
  expect(
    within(checks)
      .getAllByRole('listitem')
      .map((row) => row.getAttribute('data-check-state')),
  ).toEqual(['failed', 'running', null, null, null]);
  expect(checks.querySelector('.badge')).toBeNull();
  const reviewers = screen.getByRole('list', { name: 'Reviewers' });
  expect(
    within(reviewers)
      .getAllByRole('listitem')
      .map((row) => row.getAttribute('data-review-state')),
  ).toEqual(['changes_requested', 'approved', 'commented', 'pending']);
  expect(reviewers.querySelector('.badge')).toBeNull();
  expect(within(reviewers).getByText('Awaiting review')).toBeTruthy();
  expect(
    checks
      .querySelector('[data-check-state="running"] [role="img"]')
      ?.classList.contains('motion-safe:animate-spin'),
  ).toBe(true);
});

test('design: more than six passed checks collapse, while failures and running checks stay visible', async () => {
  const checks = [
    ...Array.from({ length: 8 }, (_, index) => ({ name: `Passed ${index + 1}`, state: 'passed' })),
    { name: 'Failure', state: 'failed' },
    { name: 'Running', state: 'running' },
  ];
  const { editor } = mount({ ...overview, checks });
  editor.actions.setReviewMode('review');
  await screen.findByRole('heading', { name: 'Why this change' });
  const group = screen.getByText('8 passed checks');
  expect(screen.getByText('Failure')).toBeTruthy();
  expect(screen.getByText('Running', { selector: '[title]' })).toBeTruthy();
  const button = required(group.closest('button'));
  expect(button.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(button);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelectorAll('[data-check-state=passed]')).toHaveLength(8);
  expect(document.querySelector('[data-check-state=passed]')?.className).toContain(
    'var(--check-icon)+var(--check-gap)',
  );
  expect(document.querySelector('[data-check-state=failed]')?.className).not.toContain(
    'var(--check-icon)',
  );
});

test('design: the description uses full document prose and keeps every supported Markdown feature', async () => {
  const { editor } = mount(documentOverview);
  editor.actions.setReviewMode('review');
  await screen.findByRole('heading', { name: 'Review the change, not the noise' });
  const body = screen.getByRole('article', { name: 'PR description' });
  expect(body.classList.contains('md')).toBe(true);
  expect(body.querySelector('.thr-body')).toBeNull();
  expect(body.querySelector('h2')?.textContent).toBe('What changed');
  expect(body.querySelector('ul li ul li')).not.toBeNull();
  const tasks = body.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(tasks).toHaveLength(3);
  expect(tasks[0]?.checked).toBe(true);
  for (const task of tasks) expect(task.disabled).toBe(true);
  expect(body.querySelector('table th')?.textContent).toBe('Surface');
  expect(body.querySelector('blockquote')).not.toBeNull();
  expect(body.querySelector('pre code i.k')).not.toBeNull();
  expect(body.querySelector('p code')?.textContent).toBe('highlightChangedWords');
  expect(within(body).getByRole('button', { name: 'Copy code' })).toBeTruthy();
  const reference = within(body).getByRole('link', { name: '#47' });
  expect(reference.getAttribute('href')).toBe('https://github.com/o/r/issues/47');
  expect(reference.getAttribute('target')).toBe('_blank');
  expect(within(body).queryByRole('link', { name: '#48' })).toBeNull();
  expect(
    within(body)
      .getByRole('link', { name: 'https://example.test/review-guide' })
      .getAttribute('target'),
  ).toBe('_blank');
  expect(within(body).getByAltText('Review flow')).toBeTruthy();
  const details = required(body.querySelector('details'));
  fireEvent.click(required(details.querySelector('summary')));
  expect(details.open).toBe(true);
});

test('design: loading uses a quiet skeleton of the same two-part layout', async () => {
  let finish: ((value: unknown) => void) | undefined;
  const pending = new Promise<unknown>((resolve) => {
    finish = resolve;
  });
  const { editor } = mount(pending);
  editor.actions.setReviewMode('review');
  try {
    expect(document.querySelectorAll('#pr-overview .skeleton').length).toBeGreaterThanOrEqual(8);
    expect(screen.getByRole('status', { name: 'Loading overview' })).toBeTruthy();
  } finally {
    finish?.(documentOverview);
  }
  await screen.findByRole('heading', { name: 'Review the change, not the noise' });
  expect(document.querySelector('#pr-overview .skeleton')).toBeNull();
});

test('scale: terminal groups are collapsed, filter searches all checks, and 500 rows expand in chunks', async () => {
  const checks = Array.from({ length: 500 }, (_, i) => ({
    id: `ci:${i}`,
    name: `Job ${i}`,
    state: 'passed',
  }));
  const { editor } = mount({ ...overview, checks, truncated: true, totalChecks: 700 });
  editor.actions.setReviewMode('review');
  await screen.findByText('500 passed checks');
  expect(document.querySelectorAll('[data-check-state]')).toHaveLength(0);
  expect(screen.getByText('Showing first 500 of 700 checks')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '500 passed checks' }));
  expect(document.querySelectorAll('[data-check-state]')).toHaveLength(40);
  while (screen.queryByRole('button', { name: /Show more passed/ }))
    fireEvent.click(screen.getByRole('button', { name: /Show more passed/ }));
  expect(document.querySelectorAll('[data-check-state]')).toHaveLength(500);
  fireEvent.input(screen.getByRole('textbox', { name: 'Filter checks' }), {
    target: { value: 'Job 499' },
  });
  expect(document.querySelectorAll('[data-check-state]')).toHaveLength(1);
});

test.each([
  ['failed', 'Checks: 1 failed'],
  ['running', 'Checks: 1 running'],
  ['passed', 'Checks: 1 passed'],
])('scale: tab count summarizes %s', async (state, label) => {
  const { editor } = mount({ ...overview, checks: [{ id: 'ci', name: 'CI', state }] });
  editor.actions.setReviewMode('review');
  expect(await screen.findByLabelText(label)).toBeTruthy();
});

test('finished checks including five passed and one skipped show a plain total', async () => {
  const checks = [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `passed-${i}`,
      name: `Passed ${i}`,
      state: 'passed',
    })),
    { id: 'skip', name: 'Skipped', state: 'skipped' },
  ];
  const { editor } = mount({ ...overview, checks });
  editor.actions.setReviewMode('review');
  const pill = await screen.findByLabelText('Checks: 5 passed, 1 skipped');
  expect(pill.classList.contains('badge')).toBe(false);
  expect(pill.getAttribute('data-variant')).toBeNull();
  expect(pill.children).toHaveLength(0);
  expect(pill.textContent).toBe('6');
});

test('Basecoat review tabs expose linked panels and roving arrow-key focus', async () => {
  const { editor } = mount();
  editor.actions.setReviewMode('review');
  await screen.findByRole('heading', { name: 'Why this change' });
  const tabs = screen.getByRole('tablist', { name: 'Review' });
  expect(tabs.parentElement?.classList.contains('tabs')).toBe(true);
  expect(tabs.getAttribute('data-variant')).toBeNull();
  expect(screen.getByRole('tab', { name: /^Overview/ }).getAttribute('aria-selected')).toBe('true');
  const overview = screen.getByRole('tab', { name: /^Overview/ });
  expect(overview.getAttribute('tabindex')).toBe('0');
  expect(overview.getAttribute('aria-controls')).toBe('pr-overview');
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(overview.id);
  fireEvent.keyDown(overview, { key: 'ArrowRight' });
  const files = screen.getByRole('tab', { name: /Changed files/ });
  expect(document.activeElement).toBe(files);
  expect(files.getAttribute('tabindex')).toBe('0');
  expect(overview.getAttribute('tabindex')).toBe('-1');
  expect(files.querySelector('.badge')).toBeNull();
  fireEvent.keyDown(files, { key: 'ArrowRight' });
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(
    'btn-review-tab-stages',
  );
  fireEvent.keyDown(document.activeElement || tabs, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(overview);
  fireEvent.keyDown(overview, { key: 'ArrowLeft' });
  expect(document.activeElement?.id).toBe('btn-review-tab-stages');
});

test.each([0, 1, 2])('terminal check group labels handle %i checks', async (count) => {
  const checks = ['passed', 'skipped', 'neutral'].flatMap((state) =>
    Array.from({ length: count }, (_, i) => ({
      id: `${state}-${i}`,
      name: `${state} ${i}`,
      state,
    })),
  );
  const { editor } = mount({ ...overview, checks });
  editor.actions.setReviewMode('review');
  await screen.findByRole('heading', { name: 'Why this change' });
  if (!count) expect(within(screen.getByRole('tabpanel')).getByText('No checks')).toBeTruthy();
  else
    for (const state of ['passed', 'skipped', 'neutral'])
      expect(
        screen.getByRole('button', { name: `${count} ${state} check${count === 1 ? '' : 's'}` }),
      ).toBeTruthy();
});

test('segmented tabs stay single-line with plain counts and no second-line layout', async () => {
  const { editor } = mount();
  editor.actions.setReviewMode('review');
  const tabs = screen.getAllByRole('tab');
  expect(tabs[0]?.querySelector('[data-tab-info]')).toBeNull();
  await screen.findByRole('heading', { name: 'Why this change' });
  for (const tab of tabs) {
    expect(tab.querySelector('[data-tab-label]')).not.toBeNull();
    expect(tab.classList.contains('flex-col!')).toBe(false);
    expect(tab.classList.contains('items-start!')).toBe(false);
    expect(tab.classList.contains('py-2!')).toBe(false);
    expect(tab.querySelector('.badge')).toBeNull();
  }
  expect(tabs[0]?.querySelector('[data-tab-info]')?.textContent).toBe('1');
  expect(tabs[1]?.querySelector('[data-tab-info]')?.textContent).toBe('1');
  fireEvent.click(required(tabs[1]));
  await screen.findByText('No changes in this pull request');
  expect(tabs[1]?.querySelector('[data-tab-info]')?.textContent).toBe('0');
  expect(tabs[1]?.parentElement?.className).not.toContain('h-auto!');
});

test('check progress keeps counts as flex weights and distinguishes skipped segments', async () => {
  const { editor } = mount({
    ...overview,
    checks: [
      ...Array.from({ length: 6 }, (_, index) => ({ name: `Check ${index}`, state: 'passed' })),
      { name: 'Optional check', state: 'skipped' },
    ],
  });
  editor.actions.setReviewMode('review');
  const progress = await screen.findByRole('img', {
    name: 'Check proportions: 6 passed, 1 skipped',
  });
  expect(progress.classList.contains('progress')).toBe(true);
  const segments = progress.querySelectorAll<HTMLSpanElement>('[data-state]');
  expect([...segments].map((segment) => [segment.dataset.state, segment.style.flexGrow])).toEqual([
    ['passed', '6'],
    ['skipped', '1'],
  ]);
  expect(screen.getByText('6 passed')).toBeTruthy();
  expect(screen.getByText('1 skipped')).toBeTruthy();
});
