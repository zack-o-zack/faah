import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { copyText } from '../lib/clipboard.ts';
import { CommitDetails } from './CommitDetails.tsx';

vi.mock('../lib/clipboard.ts', () => ({ copyText: vi.fn(async () => true) }));

const detail = {
  hash: '0123456789abcdef',
  short: 'abc1234',
  subject: 'Update lint baseline',
  message:
    'Update lint baseline\n\nThe move to internal/git renamed several files, so the\nbaseline entries pointed at paths that no longer exist.\n\n- keep paragraphs\n- keep lists',
  author: 'Zack Reader',
  email: 'zack@example.com',
  date: '2 days ago',
  dateIso: '2026-11-15T10:00:00Z',
  files: 1,
  insertions: 3,
  deletions: 10,
  authorUrl: 'https://example.com/zack',
  commitUrl: '',
};

beforeEach(() => {
  vi.mocked(copyText).mockResolvedValue(true);
});

afterEach(() => vi.restoreAllMocks());

async function hover(value: Record<string, unknown> = detail) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(value));
  render(() => (
    <CommitDetails sha="0123456789abcdef" sideWidth={340}>
      {(hover) => (
        <div onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
          A commit row
        </div>
      )}
    </CommitDetails>
  ));
  fireEvent.mouseEnter(screen.getByText('A commit row'), { clientY: 300 });
  await screen.findByText(String(value.subject ?? ''));
}

test('commit details open on hover without adding a click trigger', async () => {
  await hover({
    hash: 'abc1234',
    short: 'abc1234',
    author: 'Reader',
    subject: 'A commit',
    files: 1,
  });
  expect(screen.queryByRole('button', { name: 'Commit details' })).toBeNull();
  expect(document.getElementById('commitcard')).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(document.getElementById('commitcard')).toBeNull());
});

test('the card renders subject, reflowed body, initial, author link and date', async () => {
  await hover();
  expect(screen.getByText('Update lint baseline')).toBeTruthy();
  const body = screen.getByText(/The move to internal\/git renamed/);
  expect(body.textContent).toContain(
    'The move to internal/git renamed several files, so the baseline entries pointed at paths that no longer exist.',
  );
  expect(body.textContent).toContain('- keep paragraphs\n- keep lists');
  expect(screen.getByText('Z')).toBeTruthy();
  const author = screen.getByRole('link', { name: 'Zack Reader' });
  expect(author.getAttribute('href')).toBe('https://example.com/zack');
  expect(screen.getByTitle('2026-11-15T10:00:00Z').textContent).toBe('2 days ago');
});

test('the SHA chip copies the full hash and confirms', async () => {
  await hover();
  const chip = screen.getByTitle('Copy the full SHA');
  expect(chip.textContent).toContain('abc1234');
  fireEvent.click(chip);
  await waitFor(() => expect(copyText).toHaveBeenCalledWith('0123456789abcdef', 'Copied abc1234'));
  const copied = await screen.findByText('Copied');
  expect(copied.closest('button')?.querySelector('.icon-\\[ph--check\\]')).toBeTruthy();
});

test('the footer counts files and colours additions and deletions', async () => {
  await hover();
  const files = screen.getByText('1 file');
  expect(files.className).toContain('text-muted-foreground');
  expect(screen.getByText('+3').className).toContain('text-gi');
  expect(screen.getByText('−10').className).toContain('text-gd');
});

test('stats are hidden when files and line counts are zero', async () => {
  await hover({ ...detail, files: 0, insertions: 0, deletions: 0 });
  expect(screen.getByText('abc1234')).toBeTruthy();
  const footer = document.querySelector('#commitcard')?.lastElementChild;
  expect(footer?.textContent).toBe('abc1234');
});
