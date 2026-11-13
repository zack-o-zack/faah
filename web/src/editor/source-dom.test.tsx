import { required } from '../lib/test-values.ts';
import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { createSourceDOM } from './source-dom.ts';

test('DOM positions span highlighted nodes and exclude the gutter', () => {
  const view = render(() => (
    <div data-l="12">
      <span class="g">12</span>
      <div class="c">
        <b>first</b>
        <span> second</span>
      </div>
    </div>
  ));
  const adapter = createSourceDOM(view.container, () => ({ path: 'file.js' }));
  const code = required(view.container.querySelector<HTMLElement>('.c'));
  expect(adapter.toPoint({ line: 12, col: 7 })).toEqual([
    required(required(code.lastChild).firstChild),
    2,
  ]);
  expect(adapter.toPos(required(required(code.lastChild).firstChild), 4)).toEqual({
    line: 12,
    col: 9,
  });
  expect(
    adapter.toPos(
      required(required(view.container.querySelector<HTMLElement>('.g')).firstChild),
      1,
    ),
  ).toEqual({
    line: 12,
    col: 0,
  });
  expect(adapter.toPoint({ line: 99, col: 0 })).toBeNull();
  expect(adapter.toPoint(null)).toBeNull();
});

test('diff word hit testing uses the diff cell and its original line mapping', () => {
  const view = render(() => (
    <div data-old-l="8">
      <span class="diff-code">removedSymbol</span>
    </div>
  ));
  const code = required(view.container.querySelector<HTMLElement>('.diff-code'));
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: () => ({
      offsetNode: required(code.firstChild),
      offset: 3,
    }),
  });
  // jsdom does not implement hit testing; the browser owns these measurements.
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => code });
  const adapter = createSourceDOM(view.container, () => ({ path: 'file.js' }));
  expect(adapter.wordAtPoint(1, 1)).toEqual({
    word: 'removedSymbol',
    col: 0,
    line: 8,
    path: 'file.js',
    inDiff: true,
  });
  Reflect.deleteProperty(document, 'elementFromPoint');
  Reflect.deleteProperty(document, 'caretPositionFromPoint');
});
