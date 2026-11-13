import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { markOccurrences } from './highlights.ts';

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
