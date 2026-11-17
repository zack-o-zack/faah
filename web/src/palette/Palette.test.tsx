import { fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, expect, test, vi } from 'vitest';
import { testDocument } from '../editor/test-document.ts';
import { keyCaps } from '../lib/keyboard.ts';
import { required } from '../lib/test-values.ts';
import { MODES } from './logic.ts';
import { Palette } from './Palette.tsx';
import { createPaletteStore } from './store.ts';
import type { PaletteMode } from './types.ts';

let editor: ReturnType<typeof paletteHost> | undefined;
vi.mock('../editor/context.tsx', () => ({ useEditor: () => required(editor) }));
afterEach(() => {
  editor = undefined;
});

function paletteHost(openFiles: boolean) {
  const documents = openFiles
    ? [
        testDocument({
          path: 'src/store.ts',
          name: 'store.ts',
          total: 20,
          outline: [{ name: 'start', kind: 'function', line: 2, indent: 0 }],
        }),
      ]
    : [];
  const host = {
    store: { state: { documents: { tabs: documents } } },
    active: () => documents[0] || null,
    tree: { autoReveal: () => false },
    actions: {
      openFile: vi.fn(async () => {}),
      switchTab: vi.fn(),
      showFilesPanel: vi.fn(async () => {}),
      revealFile: vi.fn(async () => {}),
      patch: vi.fn(),
      centerLine: vi.fn(),
      pushHistory: vi.fn(),
      launchPR: vi.fn(),
    },
  };
  const request = vi.fn(async () => ({
    results: [{ path: 'src/store.ts', name: 'store.ts', pos: [4, 5] }],
  }));
  const palette = createPaletteStore(host, { request });
  palette.commands.register([{ name: 'Select theme', run: vi.fn() }]);
  return { palette, actions: palette.actions, shortcuts: { describe: () => () => {} }, request };
}
async function setup(mode: PaletteMode = 'file', openFiles = true) {
  render(() => {
    editor = paletteHost(openFiles);
    return <Palette />;
  });
  const host = required(editor);
  await host.actions.openPalette(mode);
  return { ...host, input: screen.getByRole<HTMLInputElement>('textbox') };
}

test('empty palette uses a mode icon, section headings and the shared footer instead of a chip', async () => {
  await setup();
  expect(document.querySelector('#pal-mode')).toBeNull();
  expect(document.querySelector('#pal-hint')).toBeNull();
  expect(screen.getByRole('img', { name: 'File' }).className).toContain('ph--magnifying-glass');
  expect(screen.getByPlaceholderText('Search files, symbols and commands')).toBeTruthy();
  expect(await screen.findByRole('group', { name: 'Open files' })).toBeTruthy();
  expect(screen.getByRole('group', { name: 'Jump to' })).toBeTruthy();
  expect(screen.getByText('Open files')).toBeTruthy();
  expect(screen.getByText('Jump to')).toBeTruthy();
  expect(screen.getByText('Type to search every file')).toBeTruthy();
  const footer = required(document.querySelector('footer'));
  expect(footer.textContent).toContain('Move');
  expect(footer.textContent).toContain('Open');
  expect(Array.from(footer.querySelectorAll('kbd'), (key) => key.textContent)).toEqual([
    ...keyCaps('Up'),
    ...keyCaps('Down'),
    ...keyCaps('Enter'),
  ]);
});

test('jump rows show only real shortcuts and keep the dialog open when chosen', async () => {
  const host = await setup();
  const line = await screen.findByRole('menuitem', { name: /^Line/ });
  const command = screen.getByRole('menuitem', { name: /^Run a command/ });
  expect(Array.from(line.querySelectorAll('kbd'), (key) => key.textContent)).toEqual(
    keyCaps('Mod+G'),
  );
  expect(Array.from(command.querySelectorAll('kbd'), (key) => key.textContent)).toEqual(
    keyCaps('Mod+Shift+K'),
  );
  expect(
    screen.getByRole('menuitem', { name: /^Symbol in this file/ }).querySelector('kbd'),
  ).toBeNull();
  expect(
    screen.getByRole('menuitem', { name: /^Open a pull request/ }).querySelector('kbd'),
  ).toBeNull();
  fireEvent.click(line);
  await waitFor(() => expect(host.input.value).toBe(':'));
  expect(screen.getByRole('dialog', { name: 'Line' })).toBeTruthy();
  expect(screen.getByRole('img', { name: 'Line' }).className).toContain('ph--hash');
});

test.each([
  ['@', 'symbol'],
  [':', 'line'],
  ['>', 'command'],
  ['', 'file'],
] satisfies [string, PaletteMode][])(
  'prefix %s changes the field icon to %s',
  async (prefix, mode) => {
    const host = await setup();
    fireEvent.input(host.input, { target: { value: prefix } });
    expect(screen.getByRole('img', { name: MODES[mode].label }).className).toContain(
      MODES[mode].icon,
    );
    expect(host.input.placeholder).toBe(MODES[mode].placeholder);
  },
);

test.each(['symbol', 'line', 'theme', 'openpr'] satisfies PaletteMode[])(
  '%s keeps its useful footer hint',
  async (mode) => {
    await setup(mode);
    expect(screen.getByText(MODES[mode].hint)).toBeTruthy();
    expect(screen.getByRole('img', { name: MODES[mode].label }).className).toContain(
      MODES[mode].icon,
    );
  },
);

test('typed results lose headings, highlight fuzzy hits and show the selected Open keycap', async () => {
  const host = await setup();
  fireEvent.input(host.input, { target: { value: 'st' } });
  await waitFor(() => expect(screen.queryByRole('group')).toBeNull());
  const row = await screen.findByRole('menuitem', { name: /^store.ts/ });
  expect(within(row).getByText('st').tagName).toBe('B');
  expect(within(row).getByText('src')).toBeTruthy();
  expect(within(row).getByText('Open')).toBeTruthy();
  expect(row.querySelector('kbd')?.textContent).toBe(keyCaps('Enter')[0]);
  expect(screen.queryByText('Type to search every file')).toBeNull();
  expect(host.request).toHaveBeenCalledOnce();
});

test('command results use lightning without made-up keys and have no trailing hint', async () => {
  await setup('command');
  const row = await screen.findByRole('menuitem', { name: 'Select theme' });
  expect(row.querySelector('[aria-hidden="true"]')?.className).toContain('ph--lightning');
  expect(row.querySelector('kbd')).toBeNull();
  expect(document.querySelector('footer > span:last-child')?.textContent).toBe('');
});

test('Tab and arrow navigation keep continuous indices across both sections', async () => {
  const host = await setup();
  await screen.findByRole('group', { name: 'Open files' });
  fireEvent.keyDown(host.input, { key: 'Tab' });
  expect(host.palette.state.selected).toBe(1);
  expect(screen.getByRole('menuitem', { name: /^Symbol in this file/ }).dataset.selected).toBe(
    'true',
  );
  fireEvent.keyDown(host.input, { key: 'ArrowUp' });
  expect(host.palette.state.selected).toBe(0);
  fireEvent.keyDown(host.input, { key: 'Tab', shiftKey: true });
  expect(host.palette.state.selected).toBe(4);
  fireEvent.keyDown(host.input, { key: 'Enter' });
  await waitFor(() => expect(host.palette.query().mode).toBe('openpr'));
  expect(host.palette.state.open).toBe(true);
});

test('without open tabs only Jump to renders', async () => {
  await setup('file', false);
  await screen.findByRole('group', { name: 'Jump to' });
  expect(screen.queryByRole('group', { name: 'Open files' })).toBeNull();
});
