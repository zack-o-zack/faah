import { render, screen } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { ButtonKbd } from './ButtonKbd.tsx';
import { Kbd } from './shortcuts.tsx';
import type * as Keyboard from './keyboard.ts';

const platform = vi.hoisted(() => ({ mac: false }));
vi.mock('./keyboard.ts', async (importOriginal) => {
  const keyboard = await importOriginal<typeof Keyboard>();
  return { ...keyboard, keyCaps: (combo: string) => keyboard.keyCaps(combo, platform.mac) };
});

for (const mac of [true, false]) {
  test(`button shortcuts render one cap per key on ${mac ? 'Mac' : 'PC'} without changing the action name`, () => {
    platform.mac = mac;
    render(() => (
      <button aria-keyshortcuts="Control+Shift+F">
        Search <ButtonKbd combo="Mod+Shift+F" />
      </button>
    ));
    const button = screen.getByRole('button', { name: 'Search' });
    const caps = [...button.querySelectorAll('kbd')];
    expect(caps.map((cap) => cap.textContent)).toEqual(
      mac ? ['⌘', '⇧', 'F'] : ['Ctrl', 'Shift', 'F'],
    );
    expect(button.querySelector('[data-control="shortcut"]')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    for (const cap of caps) {
      expect(cap.classList.contains('bg-current/15')).toBe(true);
      expect(cap.classList.contains('text-current')).toBe(true);
      expect(cap.dataset.variant).toBe('button');
      expect(cap.querySelector('kbd')).toBeNull();
    }
  });

  test(`exposed shortcuts name modifier caps on ${mac ? 'Mac' : 'PC'}`, () => {
    platform.mac = mac;
    const view = render(() => <Kbd combo="Mod+Shift+F" />);
    const caps = [...view.container.querySelectorAll('kbd')];
    expect(caps.map((cap) => cap.textContent)).toEqual(
      mac ? ['⌘', '⇧', 'F'] : ['Ctrl', 'Shift', 'F'],
    );
    expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
    if (mac) {
      expect(caps.map((cap) => cap.getAttribute('aria-label'))).toEqual(['Command', 'Shift', null]);
    }
  });
}

test('all system modifier glyphs have readable names', () => {
  platform.mac = true;
  const view = render(() => <Kbd combo="Mod+Ctrl+Alt+Shift+Enter" />);
  expect(
    [...view.container.querySelectorAll('kbd')].map((cap) => ({
      key: cap.textContent,
      name: cap.getAttribute('aria-label'),
      title: cap.title,
    })),
  ).toEqual([
    { key: '⌘', name: 'Command', title: 'Command' },
    { key: '⌃', name: 'Control', title: 'Control' },
    { key: '⌥', name: 'Option', title: 'Option' },
    { key: '⇧', name: 'Shift', title: 'Shift' },
    { key: '↩', name: 'Return', title: 'Return' },
  ]);
});
