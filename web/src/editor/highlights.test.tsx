import { required } from '../lib/test-values.ts';
import { render } from '@solidjs/testing-library';
import { expect, test } from 'vitest';
import { markFind, markOccurrences } from './highlights.ts';

test('occurrence marks preserve syntax and the native selection across updates', () => {
  const view = render(() => (
    <div>
      <span class="token">reader</span> reader
    </div>
  ));
  const code = required(view.container.querySelector<HTMLElement>(':scope > *'));
  const token = required(code.firstChild);
  const selection = required(document.getSelection());
  selection.setBaseAndExtent(required(token.firstChild), 1, required(token.firstChild), 5);
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
  const code = required(view.container.querySelector<HTMLElement>(':scope > *'));
  markFind(code, 'reader', false, 1);
  expect([...code.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual([
    'Reader',
    'reader',
  ]);
  expect(required(code.querySelector<HTMLElement>('mark.on')).textContent).toBe('reader');
  markFind(code, '', false);
  expect(code.querySelector('mark')).toBeNull();
});
