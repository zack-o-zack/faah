import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { markFind, markOccurrences } from './highlights.ts';

test('occurrence marks preserve syntax and the native selection across updates', () => {
  const view = render(() => (
    <div>
      <span class="token">reader</span> reader
    </div>
  ));
  const code = view.container.firstChild;
  const token = code.firstChild;
  const selection = document.getSelection();
  selection.setBaseAndExtent(token.firstChild, 1, token.firstChild, 5);
  markOccurrences(code, 'reader');
  expect(code.querySelectorAll('.occ')).toHaveLength(2);
  expect(code.querySelector('.token')).toBe(token);
  expect(selection.toString()).toBe('eade');
  markOccurrences(code, 'read');
  expect(code.querySelectorAll('.occ')).toHaveLength(2);
  expect(selection.toString()).toBe('eade');
  markOccurrences(code, '');
  expect(code.querySelectorAll('.occ')).toHaveLength(0);
  expect(code.textContent).toBe('reader reader');
  expect(selection.toString()).toBe('eade');
});
test('find uses the original marks, case matching and active match class', () => {
  const view = render(() => <div>Reader reader</div>);
  const code = view.container.firstChild;
  markFind(code, 'reader', false, 1);
  expect([...code.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
    'Reader',
    'reader',
  ]);
  expect(code.querySelector('mark.on').textContent).toBe('reader');
  markFind(code, '', false);
  expect(code.querySelector('mark')).toBeNull();
});
