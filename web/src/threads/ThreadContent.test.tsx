import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { ThreadListRow } from './ThreadListRow.tsx';
import { ThreadArtifacts } from './ThreadArtifacts.tsx';
import { decodeTurn } from './decode.ts';

test('deleting a populated thread does not open it and keyboard activation opens the row', () => {
  const open = vi.fn();
  const remove = vi.fn();
  render(() => (
    <ThreadListRow
      thread={{ id: 't', title: 'Explain startup', kind: 'explain', turns: 1, failed: true }}
      selected={false}
      onOpen={open}
      onDelete={remove}
    />
  ));
  expect(screen.getByText('Workspace')).toBeTruthy();
  expect(screen.getByTitle('Last reply failed')).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Delete thread' });
  expect(button.dataset.variant).toBe('ghost');
  expect(button.dataset.size).toBe('icon-xs');
  fireEvent.click(button);
  expect(remove).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: /Explain startup/ }), { key: 'Enter' });
  expect(open).toHaveBeenCalledOnce();
});

test('finished notes show code peeks and walkthrough steps open their source ranges', () => {
  const open = vi.fn();
  const turn = decodeTurn({
    id: 1,
    notes: [{ path: 'main.go', l1: 3, l2: 8, summary: 'Starts the workspace' }],
    walkthroughs: [
      {
        title: 'Startup',
        steps: [{ path: 'app.go', l1: 12, l2: 12, title: 'Serve', body: 'Starts the HTTP server' }],
      },
    ],
  });
  render(() => <ThreadArtifacts turn={turn} onOpen={open} />);
  expect(screen.getByText('Starts the workspace')).toBeTruthy();
  expect(document.querySelector('[data-ui=thr-peek]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '3' }));
  fireEvent.click(screen.getByRole('link', { name: 'Serve' }));
  expect(open.mock.calls).toEqual([
    [{ path: 'main.go', line: 3 }],
    [{ path: 'app.go', line: 12, end: 12 }],
  ]);
});

test('code peeks keep their folded state when a thread snapshot redraws its notes', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({ start: 0, total: 3, lines: ['one', 'two', 'three'] }),
  );
  const snapshot = (reply: string) =>
    decodeTurn({
      id: 1,
      reply,
      notes: [{ path: 'a.go', l1: 1, l2: 2, summary: 'A note', text: 'one\ntwo' }],
    });
  const [turn, setTurn] = createSignal(snapshot('first'));
  render(() => <ThreadArtifacts turn={turn()} onOpen={() => {}} />);
  const peek = document.querySelector('details');
  expect(peek).toBeInstanceOf(HTMLDetailsElement);
  if (!(peek instanceof HTMLDetailsElement)) throw new Error('Missing peek');
  peek.open = false;
  fireEvent(peek, new Event('toggle'));
  setTurn(snapshot('updated'));
  await waitFor(() => expect(document.querySelector('details')?.open).toBe(false));
  expect(screen.getByText('A note')).toBeTruthy();
});
