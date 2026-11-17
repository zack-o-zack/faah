import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, test, vi } from 'vitest';
import { createAppStore } from '../app/store.ts';
import { EditorProvider } from '../editor/context.tsx';
import { createEditorStore } from '../editor/store.ts';
import { keyChord } from '../lib/keyboard.ts';
import { HelpSheet } from './HelpSheet.tsx';

function mount() {
  const app = createAppStore();
  app.actions.setWorkspace({ version: '1.2.3' });
  const base = createEditorStore(app);
  const setVimEnabled = vi.fn();
  render(() => (
    <EditorProvider value={{ ...base, actions: { ...base.actions, setVimEnabled } }}>
      <HelpSheet />
    </EditorProvider>
  ));
  return { editor: base, setVimEnabled };
}

const cell = (label: string): Element => {
  const row = screen.getByText(label);
  if (!row.previousElementSibling) throw new Error('no key cell for ' + label);
  return row.previousElementSibling;
};

test('the sheet opens on the requested tab', () => {
  const { editor } = mount();
  editor.shortcuts.actions.showHelp();
  expect(screen.getByText('v1.2.3')).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Standard' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('General')).toBeTruthy();
  expect(screen.queryByText('Modes & Motions')).toBe(null);

  editor.shortcuts.actions.showHelp('vim');
  expect(screen.getByRole('tab', { name: 'Vim' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByText('Modes & Motions')).toBeTruthy();
  expect(screen.queryByText('General')).toBe(null);
});

test('tabs switch the sheet body and only the Vim tab offers the switch', () => {
  const { editor } = mount();
  editor.shortcuts.actions.showHelp();
  expect(screen.queryByRole('switch', { name: 'Vim navigation' })).toBe(null);
  fireEvent.click(screen.getByRole('tab', { name: 'Vim' }));
  expect(screen.getByText('Modes & Motions')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Vim navigation' })).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Standard' }));
  expect(screen.getByText('General')).toBeTruthy();
  expect(screen.queryByRole('switch', { name: 'Vim navigation' })).toBe(null);
});

test('the Vim switch saves the preference', () => {
  const { editor, setVimEnabled } = mount();
  editor.shortcuts.actions.showHelp('vim');
  const before = editor.settings.preferences().vim;
  fireEvent.click(screen.getByRole('switch', { name: 'Vim navigation' }));
  expect(setVimEnabled).toHaveBeenCalledWith(!before);
});

test('a chord is one cap and alternatives sit side by side without slashes', () => {
  const { editor } = mount();
  editor.shortcuts.actions.showHelp();

  const chord = cell('Toggle diff view (git)');
  expect(chord.querySelectorAll('kbd')).toHaveLength(1);
  expect(chord.querySelector('kbd')?.textContent).toBe(keyChord('Mod+D'));

  const alternatives = cell('Previous / next diff hunk');
  expect([...alternatives.querySelectorAll('kbd')].map((cap) => cap.textContent)).toEqual([
    keyChord('[c'),
    keyChord(']c'),
  ]);
  expect(alternatives.textContent).not.toContain('/');
});

test('the sheet uses theme classes rather than inline styles', () => {
  const { editor } = mount();
  editor.shortcuts.actions.showHelp('vim');
  const dialog = screen.getByRole('dialog');
  expect(dialog.querySelectorAll('[style]')).toHaveLength(0);
});
