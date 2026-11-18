import { scrollToItem } from '../lib/list.ts';
import { record, text } from '../lib/decode.ts';
import type { Request } from '../lib/api.ts';
import type { PaletteItem } from './types.ts';
import type { DocTab } from '../editor/types.ts';
import { testDocument } from '../editor/test-document.ts';
import { createStore } from 'solid-js/store';
function filePath(item: PaletteItem | undefined): string | undefined {
  return item?.kind === 'file' ? item.path : undefined;
}
import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createPaletteStore } from './store.ts';
import { fuzzyParts, paletteQuery } from './logic.ts';
const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
function fixture(request: Request = vi.fn(), documents: DocTab[] = [], active = 0) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [state, setEditor] = createStore({ documents: { tabs: documents, active } });
    const editor = {
      store: { state },
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
      active: () => state.documents.tabs[state.documents.active] || null,
      tree: { autoReveal: () => false },
    };
    const palette = createPaletteStore(editor, { request });
    return { ...palette, host: editor, setEditor };
  });
}
test('immediate Enter executes the current command rather than the previous query', async () => {
  const palette = fixture();
  const old = vi.fn(),
    next = vi.fn();
  palette.commands.register([
    { name: 'Audit old', run: old },
    { name: 'Audit next', run: next },
  ]);
  palette.actions.openPalette('command', '>Audit old');
  palette.actions.setPaletteQuery('>Audit next');
  await palette.actions.acceptPalette();
  expect(old).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledOnce();
});
test('empty file query lists active first, five open tabs, then jumps without finding files', async () => {
  const request = vi.fn();
  const documents = Array.from({ length: 7 }, (_, index) =>
    testDocument({ path: `src/file${index}.ts`, name: `file${index}.ts` }),
  );
  const palette = fixture(request, documents, 4);
  await palette.actions.openPalette('file');
  await vi.waitFor(() => expect(palette.items()).toHaveLength(9));
  expect(
    palette
      .items()
      .slice(0, 5)
      .map((item) => item.label),
  ).toEqual(['file4.ts', 'file0.ts', 'file1.ts', 'file2.ts', 'file3.ts']);
  expect(
    palette
      .items()
      .slice(5)
      .map((item) => item.kind === 'jump' && item.mode),
  ).toEqual(['symbol', 'line', 'command', 'openpr']);
  expect(palette.sections().map((section) => section.label)).toEqual(['Open files', 'Jump to']);
  expect(request).not.toHaveBeenCalled();
  palette.setEditor('documents', 'active', 6);
  await vi.waitFor(() => expect(palette.items()[0]?.label).toBe('file6.ts'));
});
test('empty file query without tabs only returns jumps, and choosing a tab switches it', async () => {
  const empty = fixture();
  await empty.actions.openPalette('file');
  await vi.waitFor(() => expect(empty.items()).toHaveLength(4));
  expect(empty.sections().map((section) => section.label)).toEqual(['Jump to']);
  const palette = fixture(
    vi.fn(),
    [
      testDocument({ path: 'first.ts', name: 'first.ts' }),
      testDocument({ path: 'next.ts', name: 'next.ts' }),
    ],
    1,
  );
  await palette.actions.openPalette('file');
  await palette.actions.acceptPalette(1);
  expect(palette.host.actions.switchTab).toHaveBeenCalledWith(0);
  expect(palette.host.actions.openFile).not.toHaveBeenCalled();
  expect(palette.state.open).toBe(false);
});
test.each([
  [0, 'symbol', '@'],
  [1, 'line', ':'],
  [2, 'command', '>'],
  [3, 'openpr', ''],
])('jump %s keeps the palette open in %s mode', async (index, mode, query) => {
  const palette = fixture();
  await palette.actions.openPalette('file');
  await palette.actions.acceptPalette(index);
  expect(palette.state.open).toBe(true);
  expect(palette.query().mode).toBe(mode);
  expect(palette.state.query).toBe(query);
  expect(palette.state.selected).toBe(0);
  expect(palette.host.actions.launchPR).not.toHaveBeenCalled();
});
test('selection indices continue through sections and wrap across the whole list', async () => {
  const palette = fixture(vi.fn(), [testDocument()]);
  await palette.actions.openPalette('file');
  await vi.waitFor(() => expect(palette.items()).toHaveLength(5));
  expect(
    palette.sections().flatMap((section) => section.entries.map((entry) => entry.index)),
  ).toEqual([0, 1, 2, 3, 4]);
  palette.actions.movePalette(1);
  expect(palette.state.selected).toBe(1);
  palette.actions.movePalette(-1);
  expect(palette.state.selected).toBe(0);
  palette.actions.movePalette(-1);
  expect(palette.state.selected).toBe(4);
  palette.actions.movePalette(1);
  expect(palette.state.selected).toBe(0);
});
test('typing still searches every file and returning to empty stops finding files', async () => {
  const request = vi.fn(async () => ({
    results: [{ path: 'src/store.ts', name: 'store.ts', pos: [4, 5] }],
  }));
  const palette = fixture(request);
  await palette.actions.openPalette('file');
  palette.actions.setPaletteQuery('st');
  await vi.waitFor(() => expect(filePath(palette.items()[0])).toBe('src/store.ts'));
  expect(request).toHaveBeenCalledExactlyOnceWith(
    'api/find',
    { q: 'st', limit: 120 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  palette.actions.setPaletteQuery('');
  await vi.waitFor(() => expect(palette.items()[0]?.kind).toBe('jump'));
  expect(request).toHaveBeenCalledOnce();
});
test('symbol results retain their line navigation while identifying their icon kind', async () => {
  const palette = fixture(vi.fn(), [
    testDocument({ outline: [{ name: 'start', kind: 'function', line: 8, indent: 0 }] }),
  ]);
  await palette.actions.openPalette('symbol');
  await vi.waitFor(() => expect(palette.items()[0]?.kind).toBe('symbol'));
  await palette.actions.acceptPalette();
  expect(palette.host.actions.patch).toHaveBeenCalledWith({ cur: 8 });
  expect(palette.host.actions.centerLine).toHaveBeenCalledWith(8);
});
test('old file replies cannot replace new results and requests are aborted', async () => {
  let finish: () => void = () => {
    throw new Error('Missing request');
  };
  let oldSignal: AbortSignal | null | undefined;
  const palette = fixture(
    vi.fn(async (_path: string, params: unknown, options) => {
      const q = text(record(params).q);
      if (q === 'old') {
        oldSignal = options?.signal;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }
      return { results: [{ path: q + '.go', name: q + '.go' }] };
    }),
  );
  palette.actions.openPalette('file', 'old');
  palette.actions.setPaletteQuery('new');
  await vi.waitFor(() => expect(filePath(palette.items()[0])).toBe('new.go'));
  expect(oldSignal?.aborted).toBe(true);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(filePath(palette.items()[0])).toBe('new.go');
});
test('prefixes, inert fuzzy parts and bounded native scroll calculations', () => {
  expect(paletteQuery('>Theme', 'file')).toEqual({ mode: 'command', query: 'Theme' });
  expect(paletteQuery(':123', 'theme')).toEqual({ mode: 'theme', query: ':123' });
  expect(fuzzyParts('<file>', [1, 2])).toEqual([
    { text: '<', bold: false },
    { text: 'fi', bold: true },
    { text: 'le>', bold: false },
  ]);
  expect(scrollToItem(100, 80, 110, 20)).toBe(100);
  expect(scrollToItem(100, 80, 190, 20)).toBe(130);
});
