import { createRoot } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';
import { createPaletteStore } from './store.js';
import { fuzzyParts, paletteQuery, scrollToItem } from './logic.js';
const disposers = [];
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
function fixture(request = vi.fn()) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const editor = { actions: {}, active: () => null, tree: {} };
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
  let finish;
  let oldSignal;
  const palette = fixture(
    vi.fn(async (_, { q }, options) => {
      if (q === 'old') {
        oldSignal = options.signal;
        await new Promise((resolve) => {
          finish = resolve;
        });
      }
      return { results: [{ path: q + '.go', name: q + '.go' }] };
    }),
  );
  palette.actions.openPalette('file', 'old');
  palette.actions.setPaletteQuery('new');
  await vi.waitFor(() => expect(palette.items()[0]?.path).toBe('new.go'));
  expect(oldSignal.aborted).toBe(true);
  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(palette.items()[0].path).toBe('new.go');
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
