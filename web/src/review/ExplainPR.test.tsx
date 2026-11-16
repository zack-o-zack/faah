import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { Show } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { AppShell } from '../app/AppShell.tsx';
import { createAppStore } from '../app/store.ts';
import { createEditorStore, type EditorStore } from '../editor/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { required } from '../lib/test-values.ts';
import { record, number } from '../lib/decode.ts';
import { notifications } from '../lib/toast.tsx';
import { prMeta } from '../pr/test-editor.ts';
import { decodeThread } from '../threads/decode.ts';
import { ThreadListRow } from '../threads/ThreadListRow.tsx';
import { EditorCorner } from '../viewers/EditorCorner.tsx';
import { reviewRangeText, reviewContainsRange } from '../viewers/walkthrough-review.ts';
import { ReviewView } from './ReviewView.tsx';
import type { WalkthroughFile } from './types.ts';

const file: WalkthroughFile = {
  path: 'a.go',
  group: 'core',
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      rows: [
        { type: 'ctx', oldLine: 1, newLine: 1, text: 'one' },
        { type: 'del', oldLine: 2, text: 'old' },
        { type: 'add', newLine: 2, text: 'two' },
        { type: 'ctx', oldLine: 3, newLine: 3, text: 'three' },
      ],
    },
    { oldStart: 9, newStart: 9, rows: [{ type: 'ctx', oldLine: 9, newLine: 9, text: 'nine' }] },
  ],
};
const thread = decodeThread({
  id: 'pr',
  kind: 'explain',
  title: 'Explain PR #7',
  explainReq: { pr: true },
  turns: [
    {
      id: 1,
      reply: 'PR overview.',
      walkthroughs: [
        {
          title: 'PR flow',
          steps: [
            {
              path: 'a.go',
              l1: 2,
              l2: 3,
              title: 'Change the value',
              body: 'Read the value.',
              text: 'two\nthree',
            },
            {
              path: 'a.go',
              l1: 8,
              l2: 9,
              title: 'Outside the diff',
              body: 'Read beyond the hunk.',
              text: 'eight\nnine',
            },
          ],
        },
      ],
    },
  ],
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});
function mount(
  shell = false,
  contextError = '',
  outsideNotes = 1,
  reviewFiles: WalkthroughFile[] = [file, { ...file, path: 'b.go' }],
) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({}));
  let editor: EditorStore | undefined;
  const notes = [
    {
      thread: 'pr',
      turn: 1,
      index: 0,
      path: 'a.go',
      kind: 'line',
      l1: 2,
      l2: 3,
      summary: 'Why the value changes',
      detail: 'A longer explanation.',
      text: 'two\nthree',
    },
    {
      thread: 'pr',
      turn: 1,
      index: 1,
      path: 'a.go',
      kind: 'line',
      l1: 8,
      l2: 8,
      summary: 'Outside note',
      text: 'eight',
    },
  ];
  if (outsideNotes === 2)
    notes.push({
      ...required(notes[1]),
      index: 2,
      l1: 7,
      l2: 7,
      summary: 'Another outside note',
      text: 'seven',
    });
  const request = vi.fn(async (path: string, params?: unknown) => {
    if (path === 'api/review/context') {
      if (contextError) throw new Error(contextError);
      const query = record(params);
      const lines = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
      return {
        path: query.path,
        total: lines.length,
        rows: lines.flatMap((text, index) =>
          index + 1 >= number(query.from) && index + 1 <= number(query.to)
            ? [{ line: index + 1, text, html: `<i class=k>${text}</i>` }]
            : [],
        ),
      };
    }
    if (path.includes('walkthrough'))
      return {
        files: path.includes('ignoreWhitespace') ? [] : reviewFiles,
        totalFiles: reviewFiles.length,
        hiddenWhitespaceFiles: path.includes('ignoreWhitespace') ? reviewFiles.length : 0,
      };
    if (path.includes('notes')) return { notes };
    return { config: { stages: [] } };
  });
  const post = vi.fn(async () => ({ thread }));
  const view = render(() => {
    const app = createAppStore({
      fetcher: async () => ({
        total: 9,
        start: 0,
        lines: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'],
        exact: true,
      }),
      settings: { post: async (_, body) => ({ settings: body }) },
    });
    app.actions.setWorkspace({ git: true, pr: prMeta() });
    app.actions.subscribeWorkspaceEvent = () => () => {};
    app.actions.setWorkspaceTopic = vi.fn();
    app.actions.watchWorkspaceThread = () => () => {};
    editor = createEditorStore(app, { review: { request }, threads: { request, post } });
    return (
      <EditorProvider value={editor}>
        <Show
          when={shell}
          fallback={
            <>
              <Show when={editor.review.state.mode !== 'review'}>
                <EditorCorner />
              </Show>
              <ReviewView />
            </>
          }
        >
          <AppShell />
        </Show>
      </EditorProvider>
    );
  });
  return { editor: required(editor), request, post, view };
}

test('new-side range resolution includes context/additions and rejects gaps and deletions', () => {
  expect(reviewRangeText(file, 1, 3)).toBe('one\ntwo\nthree');
  expect(reviewContainsRange(file, 2, 3)).toBe(true);
  expect(reviewRangeText(file, 3, 9)).toBeNull();
  expect(
    reviewRangeText(
      {
        ...file,
        hunks: [{ oldStart: 2, newStart: 2, rows: [{ type: 'del', oldLine: 2, text: 'old' }] }],
      },
      2,
      2,
    ),
  ).toBeNull();
  expect(
    reviewRangeText(
      {
        ...file,
        hunks: [
          { oldStart: 1, newStart: 1, rows: [{ type: 'add', newLine: 1, text: 'a' }] },
          { oldStart: 2, newStart: 2, rows: [{ type: 'ctx', oldLine: 2, newLine: 2, text: 'b' }] },
        ],
      },
      1,
      2,
    ),
  ).toBe('a\nb');
});

test.each([false, true])(
  'PR explain sends a reference, reuses one orb, and renders steps/notes in split=%s',
  async (split) => {
    const f = mount();
    await f.editor.actions.showExplanation(thread, 1);
    expect(document.querySelectorAll('#explain-orb')).toHaveLength(1);
    f.editor.actions.setReviewMode('review');
    expect(document.querySelectorAll('#explain-orb')).toHaveLength(1);
    await f.editor.settings.actions.setSetting('diffEditor.renderSideBySide', split);
    await fireEvent.click(screen.getByRole('button', { name: 'Explain PR' }));
    expect(f.post).toHaveBeenCalledWith('api/explain', { pr: true }, expect.anything());
    await waitFor(() => expect(f.editor.review.state.tab).toBe('walkthrough'));
    await screen.findByRole('button', { name: 'Why the value changes' });
    expect(f.request).toHaveBeenCalledWith('api/explain/notes', { thread: 'pr', turn: 1 });
    expect(screen.getByRole('button', { name: 'Show 1 note' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Why the value changes' }));
    expect(screen.getByRole('region', { name: 'Explanation detail' }).textContent).toContain(
      'A longer explanation.',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Why the value changes' }));
    expect(screen.queryByRole('region', { name: 'Explanation detail' })).toBeNull();
    const reveal = vi.spyOn(f.editor.review.actions, 'revealWalkthrough');
    await fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(f.editor.walkthrough.surface()).toBe('review'));
    expect(reveal).toHaveBeenCalledWith('a.go', 2);
    expect(f.editor.active()).toBeNull();
    expect(f.editor.walkthrough.outdated()).toBe(false);
    expect(document.querySelectorAll('[data-walk-title]')).toHaveLength(1);
    const focused = required(document.querySelector('[data-new-line="2"]')) as HTMLElement;
    expect(focused.style.opacity).toBe('1');
    expect(
      (required(document.querySelector('[data-new-line="1"]')) as HTMLElement).style.opacity,
    ).toBe('0.3');
    expect((required(document.querySelector('.diff-type-del')) as HTMLElement).style.opacity).toBe(
      '0.3',
    );
    const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(reveal).toHaveBeenCalledWith('a.go', 8));
    expect(open).not.toHaveBeenCalled();
    expect(f.editor.review.state.mode).toBe('review');
    expect(f.editor.walkthrough.outdated()).toBe(false);
    expect(f.editor.review.reviewFiles()[0]?.hunks).toHaveLength(1);
    const expandedRow = required(document.querySelector('[data-new-line="8"]'));
    expect(expandedRow.textContent).toContain('8');
    expect(expandedRow.querySelector('.k')?.textContent).toBe('eight');
    expect(screen.queryByRole('button', { name: 'Show 1 note' })).toBeNull();
    reveal.mockClear();
    const scroll = vi.mocked(Element.prototype.scrollIntoView);
    scroll.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(f.editor.review.state.mode).toBe('review'));
    expect(reveal).toHaveBeenCalledWith('a.go', 2);
    expect(f.editor.walkthrough.surface()).toBe('review');
    await waitFor(() =>
      expect(
        scroll.mock.contexts.some(
          (row) => row instanceof Element && row.getAttribute('data-new-line') === '2',
        ),
      ).toBe(true),
    );
    // Cross the boundary in the forward direction too.
    const reversed = decodeThread({
      ...thread,
      id: 'reverse',
      turns: [
        {
          ...thread.turns[0],
          walkthroughs: [
            {
              title: 'Reverse',
              steps: [
                {
                  ...required(required(thread.turns[0]?.walkthroughs?.[0]).steps[1]),
                  path: 'outside.go',
                },
                required(required(thread.turns[0]?.walkthroughs?.[0]).steps[0]),
              ],
            },
          ],
        },
      ],
    });
    await f.editor.actions.showExplanation(reversed, 1, { walkthrough: true });
    await waitFor(() => expect(f.editor.review.state.mode).toBe('code'));
    reveal.mockClear();
    await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(f.editor.review.state.mode).toBe('review'));
    expect(reveal).toHaveBeenCalledWith('a.go', 2);
    f.view.unmount();
  },
);

test('running PR explanations disable the review action and empty-path rows show the title', async () => {
  const f = mount();
  f.editor.actions.setReviewMode('review');
  f.editor.actions.acceptThread(decodeThread({ ...thread, turns: [{ id: 1, running: true }] }));
  const explain = screen.getByRole<HTMLButtonElement>('button', { name: 'Explain PR' });
  expect(explain.disabled).toBe(true);
  expect(explain.querySelector('[data-state=thinking]')).toBeTruthy();
  expect(explain.querySelector('[class*=sparkle]')).toBeNull();
  const row = render(() => (
    <ThreadListRow
      thread={{ id: 'pr', title: 'Explain PR #7', path: '', kind: 'explain' }}
      selected={false}
      onOpen={() => {}}
      onDelete={() => {}}
    />
  ));
  expect(row.container.querySelector('[data-ui="thr-item-ref"]')?.textContent).toBe(
    'Explain PR #7',
  );
  f.view.unmount();
  row.unmount();
});

test('review step detects outdated new-side text', async () => {
  const f = mount();
  f.editor.actions.setReviewMode('review');
  f.editor.actions.setReviewTab('walkthrough');
  await waitFor(() => expect(f.editor.review.walkthroughData()?.files.length).toBe(2));
  const changed = decodeThread({
    ...thread,
    turns: [
      {
        ...thread.turns[0],
        walkthroughs: [
          {
            title: 'Changed',
            steps: [{ path: 'a.go', l1: 2, l2: 3, title: 'Old', body: '', text: 'previous' }],
          },
        ],
      },
    ],
  });
  await f.editor.actions.showExplanation(changed, 1, { walkthrough: true });
  await waitFor(() => expect(f.editor.walkthrough.outdated()).toBe(true));
  f.view.unmount();
});

test('the actual app shell mounts one explanation orb across review mode changes', async () => {
  const f = mount(true);
  await f.editor.actions.showExplanation(thread, 1);
  expect(document.querySelectorAll('#explain-orb')).toHaveLength(1);
  expect(document.querySelector('#editor #explain-orb')).toBeTruthy();
  f.editor.actions.setReviewMode('review');
  expect(document.querySelectorAll('#explain-orb')).toHaveLength(1);
  expect(document.querySelector('#review-view #explain-orb')).toBeTruthy();
  await f.editor.actions.showExplanation(
    decodeThread({
      ...thread,
      turns: [
        {
          ...thread.turns[0],
          notes: [{ path: 'a.go', l1: 2, l2: 2, summary: 'Review note', text: 'two' }],
        },
      ],
    }),
    1,
  );
  expect(f.editor.review.state.mode).toBe('review');
  expect(document.querySelectorAll('#explain-orb')).toHaveLength(1);
  f.editor.actions.setReviewMode('code');
  expect(document.querySelectorAll('#explain-orb')).toHaveLength(1);
  expect(document.querySelector('#editor #explain-orb')).toBeTruthy();
  f.view.unmount();
});

test('Escape stops the review walkthrough before dismissing the orb and focuses the diff', async () => {
  const f = mount();
  f.editor.actions.setReviewMode('review');
  await f.editor.actions.showExplanation(thread, 1, { walkthrough: true });
  await waitFor(() => expect(f.editor.walkthrough.surface()).toBe('review'));
  await fireEvent.keyDown(screen.getByRole('region', { name: 'Walkthrough' }), { key: 'Escape' });
  expect(f.editor.store.state.explanation.walk).toBeNull();
  expect(document.querySelector('#explain-orb')).toBeTruthy();
  await fireEvent.keyDown(screen.getByRole('region', { name: 'Walkthrough' }), { key: 'Escape' });
  expect(document.querySelector('#explain-orb')).toBeNull();
  expect(document.activeElement?.id).toBe('review-diff-pane');
  f.view.unmount();
});

test('a source-started walk keeps both in-diff and out-of-diff steps in source', async () => {
  const f = mount();
  f.editor.actions.setReviewMode('review');
  f.editor.actions.setReviewTab('walkthrough');
  await waitFor(() => expect(f.editor.review.walkthroughData()?.files.length).toBe(2));
  f.editor.actions.setReviewMode('code');
  await f.editor.actions.showExplanation(thread, 1, { walkthrough: true });
  await waitFor(() => expect(f.editor.walkthrough.focus()?.l1).toBe(2));
  expect(f.editor.store.state.explanation.walk?.surface).toBe('source');
  expect(f.editor.review.state.mode).toBe('code');
  await fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(f.editor.walkthrough.focus()?.l1).toBe(8));
  await fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  await waitFor(() => expect(f.editor.walkthrough.focus()?.l1).toBe(2));
  expect(f.editor.review.state.mode).toBe('code');
  expect(f.editor.walkthrough.surface()).toBe('source');
  f.view.unmount();
});

function gapThread(text = 'three\nfour\nfive\nsix\nseven\neight\nnine', path = 'a.go') {
  return decodeThread({
    ...thread,
    turns: [
      {
        ...thread.turns[0],
        walkthroughs: [
          {
            title: 'Gap',
            steps: [{ path, l1: 3, l2: 9, title: 'Read the whole range', body: '', text }],
          },
        ],
      },
    ],
  });
}

test.each([false, true])(
  'a gap step expands padded ranges, merges headers, and compares full head text, outdated=%s',
  async (outdated) => {
    const f = mount();
    f.editor.actions.setReviewMode('review');
    const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
    const expand = vi.spyOn(f.editor.review.actions, 'expandReviewContext');
    const reveal = vi.spyOn(f.editor.review.actions, 'revealWalkthrough');
    await f.editor.actions.showExplanation(outdated ? gapThread('previous head') : gapThread(), 1, {
      walkthrough: true,
    });
    await waitFor(() => expect(reveal).toHaveBeenCalledWith('a.go', 6));
    expect(expand).toHaveBeenCalledWith('a.go', [
      { from: 4, to: 8 },
      { from: 10, to: 12 },
    ]);
    expect(open).not.toHaveBeenCalled();
    expect(f.editor.walkthrough.surface()).toBe('review');
    expect(f.editor.walkthrough.outdated()).toBe(outdated);
    expect(f.editor.review.reviewFiles()[0]?.hunks).toHaveLength(1);
    // One header for expanded a.go, two for unchanged b.go.
    expect(
      [...document.querySelectorAll('.review-diff-table > div')].filter((node) =>
        node.textContent?.startsWith('@@'),
      ),
    ).toHaveLength(3);
    f.view.unmount();
  },
);

test('expansion failure falls back to file view and reports the error', async () => {
  const f = mount(false, 'head unavailable');
  f.editor.actions.setReviewMode('review');
  const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
  await f.editor.actions.showExplanation(gapThread(), 1, { walkthrough: true });
  await waitFor(() => expect(open).toHaveBeenCalledWith({ path: 'a.go', line: 3, end: 9 }));
  await waitFor(() => expect(f.editor.walkthrough.surface()).toBe('source'));
  expect(f.editor.review.state.mode).toBe('code');
  expect(
    notifications.items().some((item) => item.title === 'Cannot expand context: head unavailable'),
  ).toBe(true);
  f.view.unmount();
});

test('non-PR and hidden files open source without requesting context', async () => {
  const f = mount();
  f.editor.actions.setReviewMode('review');
  const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
  await f.editor.actions.showExplanation(gapThread('unchanged', 'outside.go'), 1, {
    walkthrough: true,
  });
  await waitFor(() => expect(open).toHaveBeenCalledWith({ path: 'outside.go', line: 3, end: 9 }));
  expect(f.request.mock.calls.some(([path]) => path === 'api/review/context')).toBe(false);
  f.view.unmount();
});

test('stopping a walk while expansion is pending prevents a stale reveal or fallback', async () => {
  const f = mount();
  let finish: ((value: boolean) => void) | undefined;
  vi.spyOn(f.editor.review.actions, 'expandReviewContext').mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const reveal = vi.spyOn(f.editor.review.actions, 'revealWalkthrough');
  const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
  f.editor.actions.setReviewMode('review');
  await f.editor.actions.showExplanation(gapThread(), 1, { walkthrough: true });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  f.editor.actions.walkStop();
  finish?.(false);
  await Promise.resolve();
  expect(reveal).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  f.view.unmount();
});

test.each([1, 2])(
  'Show notes expands every outside note and hides at zero, count=%s',
  async (count) => {
    const f = mount(false, '', count);
    f.editor.actions.setReviewMode('review');
    f.editor.actions.setReviewTab('walkthrough');
    await f.editor.actions.showExplanation(thread, 1);
    const button = await screen.findByRole('button', {
      name: count === 1 ? 'Show 1 note' : 'Show 2 notes',
    });
    const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
    await fireEvent.click(button);
    await screen.findByRole('button', { name: 'Outside note' });
    if (count === 2) await screen.findByRole('button', { name: 'Another outside note' });
    expect(screen.queryByRole('button', { name: /Show \d+ notes?/ })).toBeNull();
    expect(f.editor.review.state.mode).toBe('review');
    expect(open).not.toHaveBeenCalled();
    f.view.unmount();
  },
);

test('Show notes falls back to the first outside note on expansion failure', async () => {
  const f = mount(false, 'cannot read head');
  f.editor.actions.setReviewMode('review');
  f.editor.actions.setReviewTab('walkthrough');
  await f.editor.actions.showExplanation(thread, 1);
  const open = vi.spyOn(f.editor.actions, 'openReviewReference');
  await fireEvent.click(await screen.findByRole('button', { name: 'Show 1 note' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith({ path: 'a.go', line: 8, end: 8 }));
  f.view.unmount();
});

test('moved files without hunks expand in review and pair context on both sides', async () => {
  const f = mount(false, '', 1, [
    { path: 'a.go', oldPath: 'old.go', status: 'R', group: 'core', hunks: [] },
  ]);
  f.editor.actions.setReviewMode('review');
  const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
  await f.editor.actions.showExplanation(gapThread(), 1, { walkthrough: true });
  await waitFor(() => expect(f.editor.walkthrough.surface()).toBe('review'));
  expect(open).not.toHaveBeenCalled();
  expect(f.editor.review.reviewFiles()[0]?.hunks?.[0]?.rows[0]).toMatchObject({
    type: 'ctx',
    oldLine: 1,
    newLine: 1,
  });
  expect(f.editor.walkthrough.outdated()).toBe(false);
  f.view.unmount();
});

test('disposed walkthroughs do not reveal or open a file after pending expansion', async () => {
  const f = mount();
  let finish: ((value: boolean) => void) | undefined;
  vi.spyOn(f.editor.review.actions, 'expandReviewContext').mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
  const reveal = vi.spyOn(f.editor.review.actions, 'revealWalkthrough');
  f.editor.actions.setReviewMode('review');
  await f.editor.actions.showExplanation(gapThread(), 1, { walkthrough: true });
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  f.view.unmount();
  finish?.(false);
  await Promise.resolve();
  expect(open).not.toHaveBeenCalled();
  expect(reveal).not.toHaveBeenCalled();
});

test('whitespace-hidden files fall back to source without expansion', async () => {
  const f = mount();
  f.editor.actions.setReviewMode('review');
  await f.editor.settings.actions.setSetting('diffEditor.ignoreWhitespace', true);
  const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
  await f.editor.actions.showExplanation(gapThread(), 1, { walkthrough: true });
  await waitFor(() => expect(open).toHaveBeenCalledWith({ path: 'a.go', line: 3, end: 9 }));
  expect(f.editor.review.walkthroughData()?.hiddenWhitespaceFiles).toBe(2);
  expect(f.request.mock.calls.some(([path]) => path === 'api/review/context')).toBe(false);
  f.view.unmount();
});

test('refreshing a walk drops expansions and re-expands the current head range', async () => {
  const f = mount();
  f.editor.actions.setReviewMode('review');
  await f.editor.actions.showExplanation(gapThread(), 1, { walkthrough: true });
  await waitFor(() => expect(f.editor.walkthrough.surface()).toBe('review'));
  f.request.mockClear();
  f.editor.actions.refreshReview();
  await waitFor(() =>
    expect(
      f.request.mock.calls.filter(([path]) => path === 'api/review/context').length,
    ).toBeGreaterThan(0),
  );
  await waitFor(() => expect(f.editor.walkthrough.surface()).toBe('review'));
  expect(f.editor.walkthrough.outdated()).toBe(false);
  f.view.unmount();
});

test('deleted PR files keep source fallback and never request new-side context', async () => {
  const f = mount(false, '', 1, [{ path: 'a.go', status: 'D', group: 'core', hunks: [] }]);
  const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
  f.editor.actions.setReviewMode('review');
  await f.editor.actions.showExplanation(gapThread(), 1, { walkthrough: true });
  await waitFor(() => expect(open).toHaveBeenCalledWith({ path: 'a.go', line: 3, end: 9 }));
  expect(f.request.mock.calls.some(([path]) => path === 'api/review/context')).toBe(false);
  f.view.unmount();
});

test('a step beyond head EOF accepts fewer rows and falls back when coverage is incomplete', async () => {
  const f = mount();
  const walk = gapThread();
  const flow = required(required(walk.turns[0]).walkthroughs?.[0]);
  required(flow.steps[0]).l2 = 12;
  const open = vi.spyOn(f.editor.review.actions, 'openReviewReference');
  f.editor.actions.setReviewMode('review');
  await f.editor.actions.showExplanation(walk, 1, { walkthrough: true });
  await waitFor(() => expect(open).toHaveBeenCalledWith({ path: 'a.go', line: 3, end: 12 }));
  await waitFor(() => expect(f.editor.walkthrough.surface()).toBe('source'));
  expect(f.editor.review.state.context['a.go']?.[8]?.text).toBe('eight');
  expect(f.editor.review.state.context['a.go']?.[12]).toBeUndefined();
  f.view.unmount();
});
