import { onCleanup } from 'solid-js';
import { createShortcut } from '../lib/shortcuts.tsx';
import { isMac } from '../lib/keyboard.ts';
import { useEditor } from './context.tsx';
import { SEL_KEYS } from './selection.ts';
import { EDITOR_HELP } from '../shortcuts/help.ts';
import { isPreview } from '../viewers/view.ts';

// A modal dialog takes the keyboard; editor keys wait until it closes.
const inDialog = (event) => !!event.target?.closest?.('dialog');

export function EditorShortcuts() {
  const editor = useEditor();
  const present = () => !!editor.active();
  const available = () => present() && !editor.ui.menu;
  const source = () =>
    available() &&
    !editor.active().isEditing &&
    !editor.active().isImage &&
    !editor.active().diffMode &&
    !isPreview(editor.active());
  const vim = (event) => {
    if (!inDialog(event) && source() && editor.actions.handleVimKeyDown(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  createShortcut(null, vim, { target: window, capture: true, preventDefault: false });
  onCleanup(editor.shortcuts.describe(EDITOR_HELP));
  const register = (combo, action, when = available, inputs = false) =>
    createShortcut(combo, action, {
      target: window,
      when: (event) => !inDialog(event) && when(),
      inputs,
      capture: true,
      stopPropagation: true,
    });
  register(
    'Mod+F',
    () => editor.actions.openFind(editor.store.state.navigation.lastWord),
    available,
    true,
  );
  register(
    'Mod+E',
    () => {
      if (editor.active().isEditing) void editor.actions.exitEditMode();
      else void editor.actions.enterEditMode();
    },
    available,
    true,
  );
  register('Mod+S', () => void editor.actions.saveActiveFile(), available, true);
  register('Alt+Z', () => editor.actions.toggleWrap(), available, true);
  register(
    'Alt+W',
    () => editor.actions.closeTabs([editor.store.state.documents.active]),
    available,
    true,
  );
  register(
    'Mod+W',
    () => editor.actions.closeTabs([editor.store.state.documents.active]),
    available,
    true,
  );
  register('Alt+Shift+H', () => editor.actions.showCalls());
  register(
    'Alt+Shift+T',
    () => void editor.actions.reopenDocument()?.then(editor.actions.activateView),
  );
  register('Alt+Left', () => void editor.actions.historyGo(-1).then(editor.actions.activateView));
  register('Alt+Right', () => void editor.actions.historyGo(1).then(editor.actions.activateView));
  register('Ctrl+Tab', () =>
    editor.actions.switchTab(
      (editor.store.state.documents.active + 1) % editor.store.state.documents.tabs.length,
    ),
  );
  register('Ctrl+Shift+Tab', () =>
    editor.actions.switchTab(
      (editor.store.state.documents.active - 1 + editor.store.state.documents.tabs.length) %
        editor.store.state.documents.tabs.length,
    ),
  );
  for (let digit = 1; digit <= 9; digit++)
    register(`Alt+${digit}`, () => editor.actions.switchTab(digit - 1));
  for (const [key, delta] of [
    ['ArrowDown', 1],
    ['ArrowUp', -1],
    ['j', 1],
    ['k', -1],
  ]) {
    register(key, () => editor.actions.move(delta), source);
    register('Shift+' + key, () => editor.actions.move(delta, true), source);
  }
  for (const [key, delta] of [
    ['ArrowRight', 1],
    ['ArrowLeft', -1],
  ]) {
    register(key, () => editor.actions.move(delta, false, 'column'), source);
    register('Shift+' + key, () => editor.actions.move(delta, true, 'column'), source);
  }
  for (const [key, end] of [
    ['Home', false],
    ['End', true],
  ]) {
    register(key, () => editor.actions.edge(end), source);
    register('Shift+' + key, () => editor.actions.edge(end, true), source);
  }
  register(
    'PageDown',
    () => editor.actions.move(Math.floor(editor.geometry.height / editor.geometry.lineHeight) - 2),
    source,
  );
  register(
    'PageUp',
    () => editor.actions.move(-Math.floor(editor.geometry.height / editor.geometry.lineHeight) + 2),
    source,
  );
  register(
    isMac ? 'Mod+ArrowUp' : 'Mod+Home',
    () => {
      editor.actions.patch({ cur: 1, col: 0 });
      editor.actions.centerLine(1);
    },
    source,
  );
  register(
    isMac ? 'Mod+ArrowDown' : 'Mod+End',
    () => {
      editor.actions.patch({ cur: editor.active().total, col: 0 });
      editor.actions.centerLine(editor.active().total);
    },
    source,
  );
  register(
    isMac ? 'Mod+ArrowLeft' : 'Ctrl+ArrowLeft',
    () => {
      if (isMac) editor.actions.edge(false);
      else editor.actions.move(-1, false, 'word');
    },
    source,
  );
  register(
    isMac ? 'Mod+ArrowRight' : 'Ctrl+ArrowRight',
    () => {
      if (isMac) editor.actions.edge(true);
      else editor.actions.move(1, false, 'word');
    },
    source,
  );
  register(
    'Mod+A',
    () => {
      if (isPreview(editor.active())) editor.services.preview?.select();
      else void editor.actions.selectAll();
    },
    () => available() && !editor.active().isEditing && !editor.active().isImage,
  );
  register(
    'Mod+C',
    () =>
      editor.actions.runSelectionAction(
        editor.ui.selection?.isMarkdownPreview ? 'copy-preview-text' : 'copy-source',
      ),
    () => available() && !!editor.ui.selection && !editor.active().isEditing,
  );
  register('F12', () => editor.actions.gotoDefinition());
  register('Shift+F12', () => editor.actions.findReferences());
  if (isMac) {
    register('Alt+ArrowLeft', () => editor.actions.move(-1, false, 'word'), source);
    register('Alt+ArrowRight', () => editor.actions.move(1, false, 'word'), source);
    register('Alt+Shift+ArrowLeft', () => editor.actions.move(-1, true, 'word'), source);
    register('Alt+Shift+ArrowRight', () => editor.actions.move(1, true, 'word'), source);
  }
  const clearModifier = (event) => {
    if (event.key === 'Meta' || event.key === 'Control')
      editor.actions.setNavigation({ link: null });
  };
  document.addEventListener('keyup', clearModifier);
  onCleanup(() => document.removeEventListener('keyup', clearModifier));
  register('Shift+F1', editor.actions.showHoverAtCaret, source);
  register(
    'Escape',
    () => {
      if (editor.ui.findOpen) editor.actions.clearFind();
      editor.actions.hideHover();
      editor.actions.clearSelection();
      editor.actions.closeSelectionMenu();
      editor.actions.setNavigation({ occurrence: null, link: null });
    },
    () =>
      present() &&
      !!(
        editor.ui.findOpen ||
        editor.ui.hover ||
        editor.ui.selection ||
        editor.ui.menu ||
        editor.store.state.navigation.occurrence
      ),
  );
  for (const [code, action] of Object.entries(SEL_KEYS)) {
    register(
      'Alt+' + code.slice(3),
      () => editor.actions.runSelectionAction(action),
      () => available() && (!!editor.ui.selection || ['thread', 'agent-edit'].includes(action)),
    );
  }
  return null;
}
