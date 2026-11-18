import { afterEach, expect, test, vi } from 'vitest';
import { render } from '@solidjs/testing-library';
import { EditorMeasure } from './EditorMeasure.tsx';

const originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
afterEach(() => {
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
});

function fontLoading() {
  let finish = () => {};
  const fonts = Object.assign(new EventTarget(), {
    ready: new Promise<void>((resolve) => {
      finish = resolve;
    }),
  });
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
  return { fonts, finish };
}

test('measures the ready font and later font swaps with their new character width', async () => {
  const { fonts, finish } = fontLoading();
  let width = 700;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
    DOMRect.fromRect({ width }),
  );
  const onMeasure = vi.fn();
  render(() => (
    <EditorMeasure fontSize={13.5} fontFamily="" lineHeight={21} onMeasure={onMeasure} />
  ));
  expect(onMeasure).toHaveBeenLastCalledWith({ lineHeight: 21, charWidth: 7 });
  width = 810;
  finish();
  await fonts.ready;
  expect(onMeasure).toHaveBeenLastCalledWith({ lineHeight: 21, charWidth: 8.1 });
  width = 930;
  fonts.dispatchEvent(new Event('loadingdone'));
  expect(onMeasure).toHaveBeenLastCalledWith({ lineHeight: 21, charWidth: 9.3 });
});

test('removes the listener and ignores a ready promise that settles after unmount', async () => {
  const { fonts, finish } = fontLoading();
  const remove = vi.spyOn(fonts, 'removeEventListener');
  const onMeasure = vi.fn();
  const view = render(() => (
    <EditorMeasure
      fontSize={14}
      fontFamily="Local Code Font"
      lineHeight={22}
      onMeasure={onMeasure}
    />
  ));
  expect(view.container.querySelector('span')?.style.fontFamily).toBe('Local Code Font');
  view.unmount();
  onMeasure.mockClear();
  fonts.dispatchEvent(new Event('loadingdone'));
  finish();
  await fonts.ready;
  expect(remove).toHaveBeenCalledWith('loadingdone', expect.any(Function));
  expect(onMeasure).not.toHaveBeenCalled();
});
