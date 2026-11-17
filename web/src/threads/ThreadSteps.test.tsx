import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { expect, test } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { required } from '../lib/test-values.ts';
import type { ThreadTurn } from './decode.ts';
import { ThreadSteps } from './ThreadSteps.tsx';
import { mockupSteps } from './test-steps.ts';

function details() {
  return required(document.querySelector<HTMLDetailsElement>('details[data-ui="thr-steps"]'));
}

test('a finished turn is collapsed and shows only the step count and caret', () => {
  render(() => <ThreadSteps turn={{ id: 1, tools: mockupSteps }} />);
  expect(details().open).toBe(false);
  const summary = required(details().querySelector('summary'));
  expect(summary.textContent).toBe('24 steps');
  expect(summary.querySelectorAll('span')).toHaveLength(1);
  expect(within(summary).queryByRole('button')).toBeNull();
  expect(within(summary).queryByRole('list')).toBeNull();
});

test('run disclosure opens individual rows inline and retains all original titles', async () => {
  const user = userEvent.setup();
  render(() => <ThreadSteps turn={{ id: 1, tools: mockupSteps }} />);
  details().open = true;
  const runs = screen.getAllByRole('button', { expanded: false });
  expect(runs).toHaveLength(2);
  const first = required(runs[0]);
  expect(first.textContent).toContain('3 files');
  expect(first.textContent).toContain('probe.go, git.go, status.go');
  expect(first.title).toBe(mockupSteps.slice(0, 3).join('\n'));
  first.focus();
  await user.keyboard('{Enter}');
  expect(first.getAttribute('aria-expanded')).toBe('true');
  const nested = required(first.parentElement?.querySelector('ol'));
  expect(
    within(nested)
      .getAllByRole('listitem')
      .map((row) => row.title),
  ).toEqual(mockupSteps.slice(0, 3));
  expect(screen.getByText('×2').parentElement?.title).toBe('Edit internal/git/probe.go');
  expect(screen.getByTitle('Bash git status --short').textContent).toContain('git status --short');
  await fireEvent.click(first);
  expect(first.getAttribute('aria-expanded')).toBe('false');
  expect(first.parentElement?.querySelector('ol')).toBeNull();
});

test('paths derive from live workspace metadata and folders use rtl with bdi', () => {
  const app = createAppStore();
  app.actions.setWorkspace({ root: '/home/me/repo', home: '/home/me' });
  render(() => (
    <ThreadSteps
      turn={{ id: 1, tools: ['Read /home/me/repo/src/file.ts', 'Write /home/me/notes/MEMORY.md'] }}
      workspace={app.state.workspace.meta}
    />
  ));
  details().open = true;
  expect(screen.getByText('file.ts')).toBeTruthy();
  expect(screen.getByText('src/').tagName).toBe('BDI');
  expect(screen.getByText('src/').parentElement?.className).toContain('[direction:rtl]');
  expect(screen.getByText('~/notes/')).toBeTruthy();
  app.actions.setWorkspace({ root: '/elsewhere', home: '/home/me' });
  expect(screen.getByText('~/repo/src/')).toBeTruthy();
});

test('running head stays a thinking spiral and tracks streamed labels without resetting an open run', () => {
  const [turn, setTurn] = createSignal<ThreadTurn>({ id: 1, running: true });
  render(() => <ThreadSteps turn={turn()} />);
  expect(screen.getByText('Starting')).toBeTruthy();
  expect(document.querySelector('.fibo-spiral[data-state="thinking"]')).toBeTruthy();
  const reads = (count: number) =>
    Array.from({ length: count }, (_, index) => `Read src/file${index}.ts`);
  setTurn({ id: 1, running: true, tools: reads(9) });
  details().open = true;
  expect(required(details().querySelector('summary')).textContent).toBe('Read src/file8.ts');
  fireEvent.click(screen.getByRole('button'));
  setTurn({ id: 1, running: true, tools: reads(10) });
  expect(screen.getByRole('button', { expanded: true }).textContent).toContain('10 files');
  expect(screen.getByTitle('Read src/file9.ts')).toBeTruthy();
  setTurn({ id: 1, tools: ['Show notes'] });
  expect(required(details().querySelector('summary')).textContent).toBe('1 step');
  expect(screen.getByTitle('Show notes').querySelector('.text-special')).toBeTruthy();
  expect(document.querySelector('[data-state="thinking"]')).toBeNull();
});

test('rows inside a group show only their target, not the icon and verb again', () => {
  render(() => <ThreadSteps turn={{ id: 1, tools: mockupSteps }} />);
  details().open = true;
  const first = required(screen.getAllByRole('button', { expanded: false })[0]);
  fireEvent.click(first);
  const nested = required(first.parentElement?.querySelector('ol'));
  for (const row of within(nested).getAllByRole('listitem')) {
    expect(row.querySelector('[class*="icon-[ph--"]')).toBeNull();
    expect(row.textContent).not.toContain('Read');
  }
});

test('a short turn of commands shows each command on its own row', () => {
  const tools = ['Bash wc -l internal/git/*.go', 'Bash grep -n "^#" docs/a.md', 'Bash git status'];
  render(() => <ThreadSteps turn={{ id: 1, tools }} />);
  details().open = true;
  expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  for (const label of tools) expect(screen.getByTitle(label)).toBeTruthy();
});

test('a turn without steps or running work has no steps UI', () => {
  const { container } = render(() => <ThreadSteps turn={{ id: 1 }} />);
  expect(container.textContent).toBe('');
  expect(container.querySelector('[data-ui="thr-steps"]')).toBeNull();
});
