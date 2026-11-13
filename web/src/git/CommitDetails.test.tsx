import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { CommitDetails } from './CommitDetails.tsx';

afterEach(() => vi.restoreAllMocks());
test('commit details open on hover without adding a click trigger', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      hash: 'abc1234',
      short: 'abc1234',
      author: 'Reader',
      subject: 'A commit',
      files: 1,
    }),
  );
  render(() => (
    <CommitDetails sha="abc1234" sideWidth={340}>
      {(hover) => (
        <div onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
          A commit row
        </div>
      )}
    </CommitDetails>
  ));
  expect(screen.queryByRole('button', { name: 'Commit details' })).toBeNull();
  expect(document.getElementById('commitcard')).toBeNull();
  fireEvent.mouseEnter(screen.getByText('A commit row'), { clientY: 300 });
  await screen.findByText('Copy SHA');
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.getElementById('commitcard')).toBeNull());
});
