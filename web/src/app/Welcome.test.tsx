import { render, screen } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { Welcome } from './Welcome.tsx';

test('the welcome screen shows the version and key caps, and hides with a file open', () => {
  const view = render(() => <Welcome hidden={false} version="1.2.3" />);
  expect(screen.getByText('v1.2.3')).toBeTruthy();
  expect(screen.getByText('go to definition').previousElementSibling?.textContent).toBe('F12');
  expect(screen.getByText('type and docs').previousElementSibling?.textContent).toBe('hover');
  view.unmount();
  render(() => <Welcome hidden version="" />);
  expect(document.getElementById('empty')?.hidden).toBe(true);
  expect(document.getElementById('empty-ver')?.textContent).toBe('');
});
