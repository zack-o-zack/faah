import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { expect, test } from 'vitest';
import { TabRail } from './TabRail.tsx';

function mount() {
  const [selected, select] = createSignal('First');
  render(() => (
    <TabRail label="View">
      <For each={['First', 'Disabled', 'Middle', 'Last']}>
        {(name) => (
          <button
            role="tab"
            aria-selected={selected() === name}
            tabindex={selected() === name ? 0 : -1}
            disabled={name === 'Disabled'}
            onClick={() => select(name)}
          >
            {name}
          </button>
        )}
      </For>
    </TabRail>
  ));
  return (name: string) => screen.getByRole<HTMLButtonElement>('tab', { name });
}

test('arrow keys activate and focus enabled tabs, wrapping in either direction', () => {
  const tab = mount();
  tab('First').focus();
  for (const [key, name] of [
    ['ArrowRight', 'Middle'],
    ['ArrowRight', 'Last'],
    ['ArrowRight', 'First'],
    ['ArrowLeft', 'Last'],
    ['ArrowLeft', 'Middle'],
  ]) {
    fireEvent.keyDown(document.activeElement || tab('First'), { key });
    expect(document.activeElement).toBe(tab(name || ''));
    expect(tab(name || '').getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab').filter((element) => element.tabIndex === 0)).toEqual([
      tab(name || ''),
    ]);
  }
});

test('Home and End activate the first and last tabs and leave other keys alone', () => {
  const tab = mount();
  tab('Middle').focus();
  fireEvent.keyDown(tab('Middle'), { key: 'End' });
  expect(document.activeElement).toBe(tab('Last'));
  expect(tab('Last').getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(tab('Last'), { key: 'Home' });
  expect(document.activeElement).toBe(tab('First'));
  expect(tab('First').getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(tab('First'), { key: 'ArrowDown' });
  fireEvent.keyDown(tab('First'), { key: 'ArrowRight', metaKey: true });
  expect(document.activeElement).toBe(tab('First'));
});
