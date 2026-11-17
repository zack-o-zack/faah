import { required } from '../lib/test-values.ts';
import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { WorkbenchProvider } from './context.tsx';
import { PathSuggestions } from './PathSuggestions.tsx';
import { createWorkbenchStore } from './store.ts';

test.each([
  { home: '/home/me', sep: '/', parent: '~/Projects', path: '/home/me/Projects/' },
  { home: 'C:\\Users\\me', sep: '\\', parent: '~\\Projects', path: 'C:\\Users\\me\\Projects\\' },
])(
  'rows show names once and their parent using separator $sep',
  async ({ home, sep, parent, path }) => {
    const store = createWorkbenchStore(async () => ({ home, sep }));
    await store.actions.refresh();
    const accept = vi.fn();
    render(() => {
      const [selected, setSelected] = createSignal(0);
      return (
        <WorkbenchProvider store={store}>
          <PathSuggestions
            id="folders"
            entries={[
              { name: 'config', path: `${path}config${sep}` },
              { name: 'core', path: `${path}core${sep}`, git: true },
            ]}
            selected={selected()}
            onAccept={accept}
          />
          <button onClick={() => setSelected(1)}>Select next</button>
        </WorkbenchProvider>
      );
    });
    const rows = screen.getAllByRole('option');
    for (const [index, name] of ['config', 'core'].entries()) {
      const row = required(rows[index]);
      expect(within(row).getAllByText(name)).toHaveLength(1);
      expect(row.textContent?.split(name)).toHaveLength(2);
      expect(within(row).getByText(parent)).toBeTruthy();
      expect(row.textContent).not.toContain(`${name}${sep}`);
    }
    expect(required(rows[0]).querySelector('.icon-\\[ph--folder\\]')).toBeTruthy();
    const branch = required(rows[1]).querySelector('.icon-\\[ph--git-branch\\]');
    expect(branch).toBeTruthy();
    expect(branch?.classList.contains('text-gi')).toBe(false);
    expect(branch?.classList.contains('text-muted-foreground')).toBe(true);
    expect(within(required(rows[0])).getByText('inside')).toBeTruthy();
    expect(within(required(rows[0])).getByText('Open')).toBeTruthy();
    expect(required(rows[0]).querySelectorAll('kbd')).toHaveLength(2);
    expect(required(rows[1]).querySelector('kbd')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Select next' }));
    expect(required(rows[0]).getAttribute('aria-selected')).toBe('false');
    expect(required(rows[0]).querySelector('kbd')).toBeNull();
    expect(required(rows[1]).getAttribute('aria-selected')).toBe('true');
    expect(within(required(rows[1])).getByText('inside')).toBeTruthy();

    const popover = required(screen.getByRole('listbox').closest('[data-popover]'));
    const footer = required(popover.querySelector('footer'));
    expect(within(footer).getByText('Move')).toBeTruthy();
    expect(within(footer).getByText('Go inside')).toBeTruthy();
    expect(within(footer).getByText('Open')).toBeTruthy();
    expect(footer.querySelectorAll('kbd')).toHaveLength(4);
    expect(footer.querySelectorAll('[data-control="shortcut"]')).toHaveLength(3);
    fireEvent.mouseDown(required(rows[1]));
    expect(accept).toHaveBeenCalledExactlyOnceWith(1);
  },
);
