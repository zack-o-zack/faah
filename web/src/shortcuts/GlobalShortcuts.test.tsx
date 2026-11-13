import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { expect, test, vi } from 'vitest';
import { EditorProvider } from '../editor/context.jsx';
import { isMac } from '../lib/keyboard.js';
import { GlobalShortcuts } from './GlobalShortcuts.tsx';
import { HelpSheet } from './HelpSheet.tsx';
import { createShortcutRegistry } from './registry.ts';

function mount({ git = true, right = false, threads = false } = {}) {
  const [state] = createStore({
    workspace: { meta: { git, version: '1.2.3' } },
    layout: { right, threads },
  });
  const shortcuts = createShortcutRegistry();
  const actions = {
    openSettings: vi.fn(),
    openPalette: vi.fn(),
    showRightInspector: vi.fn(),
    hideRightInspector: vi.fn(),
    hideThreads: vi.fn(),
    togglePanel: vi.fn(),
    reindexWorkspace: vi.fn(async () => {}),
    toggleActiveDiff: vi.fn(),
    toggleActivePreview: vi.fn(),
    stepDiffHunk: vi.fn(),
    stepChangedFile: vi.fn(async () => {}),
    showHelp: shortcuts.actions.showHelp,
    showVimHelp: vi.fn(),
  };
  const imageKey = vi.fn(() => true);
  const editor = {
    shortcuts,
    store: { state },
    active: () => ({ isImage: true }),
    services: { imageKey },
    actions,
  };
  render(() => (
    <EditorProvider value={editor}>
      <GlobalShortcuts />
      <HelpSheet />
    </EditorProvider>
  ));
  return { actions, imageKey };
}
const mod: KeyboardEventInit = isMac ? { metaKey: true } : { ctrlKey: true };
const key = (key: string, init: KeyboardEventInit = {}, target: Element = document.body) =>
  fireEvent.keyDown(target, { key, code: 'Key' + key.toUpperCase(), ...init });

test('modifier shortcuts reach their actions, in fields too', () => {
  const { actions } = mount();
  const field = document.body.appendChild(document.createElement('input'));
  key(',', mod, field);
  field.remove();
  expect(actions.openSettings).toHaveBeenCalledWith('ui');
  key('k', mod);
  expect(actions.openPalette).toHaveBeenCalledWith('file');
  key('j', mod);
  expect(actions.showRightInspector).toHaveBeenCalledWith();
  key('d', mod);
  expect(actions.toggleActiveDiff).toHaveBeenCalled();
  key('m', { altKey: true });
  expect(actions.toggleActivePreview).toHaveBeenCalled();
});

test('Mod+D is left to the browser without git', () => {
  const { actions } = mount({ git: false });
  key('d', mod);
  expect(actions.toggleActiveDiff).not.toHaveBeenCalled();
});

test('chords step hunks and files; other keys go to the image viewer', () => {
  const { actions, imageKey } = mount();
  key(']');
  key('c');
  expect(actions.stepDiffHunk).toHaveBeenCalledWith(1);
  key('[');
  key('f');
  expect(actions.stepChangedFile).toHaveBeenCalledWith(-1);
  key('+');
  expect(imageKey).toHaveBeenCalled();
});

test('Escape closes the threads panel before the inspector', () => {
  const { actions } = mount({ right: true, threads: true });
  key('Escape');
  expect(actions.hideThreads).toHaveBeenCalled();
  expect(actions.hideRightInspector).not.toHaveBeenCalled();
});

test('? shows the help sheet listing the bound shortcuts', () => {
  const { actions } = mount();
  key('?');
  expect(screen.getByText('Keyboard Shortcuts')).toBeTruthy();
  expect(screen.getByText('v1.2.3')).toBeTruthy();
  expect(screen.getByText('Previous / next diff hunk')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View Vim Keybindings' }));
  expect(actions.showVimHelp).toHaveBeenCalled();
  expect(screen.queryByText('Keyboard Shortcuts')).toBe(null);
});
