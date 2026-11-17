import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import type { ThemeStore } from '../lib/theme.ts';
import { ThemeProvider } from '../lib/theme-context.tsx';
import { WorkbenchProvider } from './context.tsx';
import { createWorkbenchStore } from './store.ts';
import { WorkbenchFooter } from './WorkbenchFooter.tsx';

function mount() {
  const [value, setValue] = createSignal('');
  const theme: ThemeStore = {
    preference: value,
    current: value,
    themes: () => [],
    setTheme: (id) => {
      setValue(id);
      return true;
    },
  };
  render(() => (
    <ThemeProvider store={theme}>
      <WorkbenchProvider store={createWorkbenchStore(vi.fn(), vi.fn(), vi.fn())}>
        <WorkbenchFooter />
      </WorkbenchProvider>
    </ThemeProvider>
  ));
}

test('the repo link uses the Simple Icons brand mark', () => {
  mount();
  const link = screen.getByRole('link', { name: 'fibo on GitHub' });
  const icon = link.querySelector('span');
  expect(icon?.classList.contains('icon-[simple-icons--github]')).toBe(true);
  expect(link.innerHTML).not.toContain('github-logo');
});

test('the footer theme button cycles through all three modes', () => {
  mount();
  const button = screen.getByRole('button', { name: 'Theme: System. Switch to Light' });
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Theme: Light. Switch to Dark' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Theme: Light. Switch to Dark' }));
  expect(screen.getByRole('button', { name: 'Theme: Dark. Switch to System' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Theme: Dark. Switch to System' }));
  expect(screen.getByRole('button', { name: 'Theme: System. Switch to Light' })).toBeTruthy();
});
