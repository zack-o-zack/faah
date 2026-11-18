import { render } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore } from '../editor/store.ts';
import { createGitStore } from './store.ts';
import { CommitRow } from './CommitRow.tsx';

function mount(commit: Parameters<typeof CommitRow>[0]['commit'], unpushed = false) {
  return render(() => {
    const app = createAppStore();
    const git = createGitStore(app, { post: vi.fn(), request: vi.fn(), openFile: vi.fn() });
    const base = createEditorStore(app);
    const editor = { ...base, git, actions: { ...base.actions, ...git.actions } };
    return (
      <EditorProvider value={editor}>
        <CommitRow commit={commit} unpushed={unpushed} />
      </EditorProvider>
    );
  });
}

test('a pushed commit row has no native title tooltip', () => {
  const view = mount({
    full: 'abc1234',
    hash: 'abc1234',
    subject: 'A pushed commit',
    author: 'Reader',
    date: '2 days ago',
  });
  const row = view.container.querySelector('[data-sha] > [role="button"]');
  expect(row?.hasAttribute('title')).toBe(false);
});

test('an unpushed commit row has no native title tooltip', () => {
  const view = mount(
    {
      hash: 'def5678',
      short: 'def5678',
      subject: 'An unpushed commit',
      author: 'Reader',
      date: 'today',
    },
    true,
  );
  const row = view.container.querySelector('[data-sha] > [role="button"]');
  expect(row?.hasAttribute('title')).toBe(false);
});
