import { record, text } from '../lib/decode.ts';
import type { Request } from '../lib/api.ts';
import type { PaletteItem } from './types.ts';
function filePath(item: PaletteItem | undefined): string | undefined {
  return item?.kind === 'file' ? item.path : undefined;
}
import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createPaletteStore } from './store.ts';
import { fuzzyParts, paletteQuery, scrollToItem } from './logic.ts';
const disposers: (() => void)[] = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
function fixture(request: Request = vi.fn()) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const editor = {
      actions: {
        openFile: vi.fn(async () => {}),
        showFilesPanel: vi.fn(async () => {}),
        revealFile: vi.fn(async () => {}),
        patch: vi.fn(),
        centerLine: vi.fn(),
        pushHistory: vi.fn(),
        launchPR: vi.fn(),
      },
      active: () => null,
      tree: { autoReveal: () => false },
    };
    const palette = createPaletteStore(editor, { request });
    return palette;
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
